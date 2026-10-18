require "test_helper"

# Abrupt worker loss is simulated by raising an Exception subclass, which ProfileJob's
# StandardError handling does not catch, while the profile is being built. The run's
# 'processing' status was already committed; the job's ensure block releases its advisory lock,
# as PostgreSQL does when a killed worker's connection ends.
class AbandonedProfileTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  class SimulatedWorkerLoss < Exception; end # rubocop:disable Lint/InheritException

  setup do
    @reporter = User.create!(name: "Profile Reporter", email: "abandoned-profile@example.test", role: "reporter", password: "Learning123!")
    InfrastructureAsset.create!(asset_code: "AB-1", name: "First tower", kind: "tower", longitude: -105.28, latitude: 39.98, ground_elevation_m: 1600, structure_height_m: 30, corridor_order: 0)
    InfrastructureAsset.create!(asset_code: "AB-2", name: "Second pole", kind: "pole", longitude: -105.27, latitude: 39.98, ground_elevation_m: 1620, structure_height_m: 20, corridor_order: 1)
    post "/api/session", params: { email: @reporter.email, password: "Learning123!" }, as: :json
    assert_response :success
  end

  def replace_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  def interrupted_run
    post "/api/profile_runs", as: :json
    assert_response :accepted
    run = ProfileRun.find(response.parsed_body.dig("profile_run", "id"))
    clear_enqueued_jobs
    replace_method(CorridorProfile, :build, ->(_assets) { raise SimulatedWorkerLoss }) do
      assert_raises(SimulatedWorkerLoss) { ProfileJob.perform_now(run.id, run.generation) }
    end
    assert_equal "processing", run.reload.status
    run
  end

  # Holds the job's advisory lock from a separate database session, as a live worker would.
  def with_worker_holding_lock(run)
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    worker = PG.connect(host: config[:host], port: config[:port], dbname: config[:database], user: config[:username], password: config[:password])
    worker.exec_params("SELECT pg_advisory_lock($1, $2)", [ProfileRun::ADVISORY_LOCK_KEY, run.id])
    yield
  ensure
    worker&.close
  end

  test "a profile run abandoned while processing is reported, resumed through retry, and completes" do
    run = interrupted_run
    get "/api/profile_runs"
    assert_equal true, response.parsed_body["profile_runs"].find { |item| item["id"] == run.id }["abandoned"]

    post "/api/profile_runs/#{run.id}/retry", as: :json
    assert_response :accepted
    assert_equal ["pending", 1], [run.reload.status, run.generation]
    assert_enqueued_jobs 1, only: ProfileJob
    perform_enqueued_jobs
    run.reload
    assert_equal "completed", run.status
    assert_equal 11, run.samples.length, "Ten samples along the one segment plus the endpoint"
    assert_equal false, run.abandoned?
  end

  test "a profile run whose worker still holds its lock is not restarted or processed twice" do
    run = interrupted_run
    with_worker_holding_lock(run) do
      assert_equal false, run.abandoned?
      post "/api/profile_runs/#{run.id}/retry", as: :json
      assert_response :conflict
      assert_equal "This profile run is still being processed", response.parsed_body["error"]
      get "/api/profile_runs/#{run.id}"
      assert_equal false, response.parsed_body.dig("profile_run", "abandoned")
      # A second delivery of the same run exits while the first worker holds it.
      ProfileJob.perform_now(run.id, run.generation)
      assert_equal "processing", run.reload.status
      assert_no_enqueued_jobs only: ProfileJob
    end
    assert run.abandoned?, "Once the worker session ends, the run counts as abandoned"
  end
end
