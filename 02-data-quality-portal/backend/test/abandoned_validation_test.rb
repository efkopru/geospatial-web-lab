require "test_helper"

# Abrupt worker loss is simulated as the issue describes: an Exception subclass, which the job's
# StandardError handling does not catch, is raised after the job has committed 'validating'. The
# job's ensure block still releases its advisory lock, as PostgreSQL does when a killed worker's
# connection ends.
class AbandonedValidationTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  class SimulatedWorkerLoss < Exception; end # rubocop:disable Lint/InheritException

  setup do
    @reporter = User.create!(email: "abandoned-validation@example.test", name: "Validation Reporter", role: "reporter", password: "Learning123!")
    post "/api/session", params: { email: @reporter.email, password: "Learning123!" }, as: :json
    assert_response :success
    @source = Rails.root.join("samples", "parks-with-errors.geojson").read
  end

  def replace_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  # Uploads the sample and runs validation until the worker is "lost" after the first record.
  def interrupted_validation
    post "/api/datasets", params: { name: "Interrupted parks", source: @source }, as: :json
    assert_response :created
    dataset = Dataset.find(response.parsed_body.dig("dataset", "id"))
    clear_enqueued_jobs
    checked = 0
    original = GeojsonValidator.method(:new)
    interrupt = lambda do |**options|
      validator = original.call(**options)
      validator.define_singleton_method(:errors_for) { |feature| (checked += 1) > 1 ? raise(SimulatedWorkerLoss) : super(feature) }
      validator
    end
    replace_method(GeojsonValidator, :new, interrupt) do
      assert_raises(SimulatedWorkerLoss) { ValidateDatasetJob.perform_now(dataset.id) }
    end
    assert_equal "validating", dataset.reload.status
    dataset
  end

  # Holds the job's advisory lock from a separate database session, as a live worker would.
  def with_worker_holding_lock(dataset)
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    worker = PG.connect(host: config[:host], port: config[:port], dbname: config[:database], user: config[:username], password: config[:password])
    worker.exec_params("SELECT pg_advisory_lock($1::bigint)", [Dataset.validation_lock_key(dataset.id)])
    yield
  ensure
    worker&.close
  end

  test "a validation abandoned midway is reported, resumed through retry, and completes without duplicate records" do
    dataset = interrupted_validation
    assert_equal 1, dataset.dataset_records.count
    get "/api/datasets"
    assert_equal true, response.parsed_body["datasets"].find { |item| item["id"] == dataset.id }["abandoned"]

    post "/api/datasets/#{dataset.id}/retry", as: :json
    assert_response :success
    assert_enqueued_jobs 1, only: ValidateDatasetJob
    perform_enqueued_jobs
    dataset.reload
    assert_equal "ready", dataset.status
    assert_equal dataset.total_count, dataset.dataset_records.count
    assert_equal dataset.total_count, dataset.processed_count
    assert_equal false, dataset.abandoned?
  end

  test "uploading the same file again resumes an abandoned validation" do
    dataset = interrupted_validation
    post "/api/datasets", params: { name: "Interrupted parks", source: @source }, as: :json
    assert_response :success
    assert_equal [true, dataset.id], [response.parsed_body["duplicate"], response.parsed_body.dig("dataset", "id")]
    assert_enqueued_jobs 1, only: ValidateDatasetJob
    perform_enqueued_jobs
    assert_equal "ready", dataset.reload.status
    assert_equal dataset.total_count, dataset.dataset_records.count
  end

  test "a validation whose worker still holds its lock is not restarted" do
    dataset = interrupted_validation
    with_worker_holding_lock(dataset) do
      assert_equal false, dataset.abandoned?
      post "/api/datasets/#{dataset.id}/retry", as: :json
      assert_response :unprocessable_entity
      assert_equal "This dataset is still being validated", response.parsed_body["error"]
      post "/api/datasets", params: { name: "Interrupted parks", source: @source }, as: :json
      assert_response :success
      assert_equal false, response.parsed_body.dig("dataset", "abandoned")
      assert_no_enqueued_jobs only: ValidateDatasetJob
      assert_equal "validating", dataset.reload.status
    end
    assert dataset.abandoned?, "Once the worker session ends, the dataset counts as abandoned"
  end
end
