require "test_helper"

module ProfileOwnershipFixtures
  def create_owner(email, role = "reporter")
    User.create!(name: "Profile owner", email: email, role: role, password: "Learning123!")
  end

  def snapshot
    [
      { "longitude" => -105.28, "latitude" => 39.98, "ground_elevation_m" => 1600, "structure_height_m" => 30 },
      { "longitude" => -105.27, "latitude" => 39.98, "ground_elevation_m" => 1620, "structure_height_m" => 20 }
    ]
  end

  def create_run(owner, status = "completed")
    ProfileRun.create!(user: owner, status: status, asset_snapshot: snapshot,
      samples: [{ "longitude" => -105.28, "latitude" => 39.98, "distance_m" => 0, "elevation_m" => 1600 }],
      summary: { "private_marker" => owner.email })
  end
end

class ProfileOwnershipApiTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include ProfileOwnershipFixtures

  setup do
    @reporter = create_owner("profile-owner@example.test")
    @staff = create_owner("profile-other-owner@example.test", "staff")
    clear_enqueued_jobs
  end

  test "the newest ten list is scoped before limiting, for both reporters and staff" do
    reporter_runs = 11.times.map { create_run(@reporter) }
    staff_runs = 11.times.map { create_run(@staff) }
    [[@reporter, reporter_runs], [@staff, staff_runs]].each do |user, runs|
      login(user)
      get "/api/profile_runs"
      assert_response :success
      assert_equal runs.last(10).reverse.map(&:id), response.parsed_body.fetch("profile_runs").map { |run| run.fetch("id") }
      assert response.parsed_body.fetch("profile_runs").all? { |run| run.dig("summary", "private_marker") == user.email }
    end
  end

  test "details downloads and retries hide other owners' runs even from staff" do
    [[@reporter, @staff], [@staff, @reporter]].each do |owner, other|
      completed = create_run(owner)
      failed = create_run(owner, "failed")
      abandoned = create_run(owner, "processing")
      login(other)
      get "/api/profile_runs/#{completed.id}"
      assert_response :not_found
      get "/api/profile_runs/#{completed.id}/download"
      assert_response :not_found
      [failed, abandoned, completed].each do |run|
        before = run.attributes
        assert_no_enqueued_jobs do
          post "/api/profile_runs/#{run.id}/retry", as: :json
          assert_response :not_found
        end
        assert_equal before, run.reload.attributes
      end

      login(owner)
      get "/api/profile_runs/#{completed.id}"
      assert_response :success
      assert_equal owner.email, response.parsed_body.dig("profile_run", "summary", "private_marker")
      get "/api/profile_runs/#{completed.id}/download"
      assert_response :success
      assert_equal owner.email, JSON.parse(response.body).dig("metadata", "summary", "private_marker")
      [failed, abandoned].each do |run|
        assert_enqueued_with(job: ProfileJob, args: [run.id, run.generation + 1]) do
          post "/api/profile_runs/#{run.id}/retry", as: :json
          assert_response :accepted
        end
        assert_equal "pending", run.reload.status
      end
    end
  end

  test "creation derives its owner from the session and ignores supplied owner ids" do
    snapshot.each_with_index do |values, index|
      InfrastructureAsset.create!(values.merge(asset_code: "OWN-#{index}", name: "Ownership test asset", kind: "tower", corridor_order: index))
    end
    login(@reporter)
    assert_enqueued_with(job: ProfileJob) do
      post "/api/profile_runs", params: { user_id: @staff.id, profile_run: { user_id: @staff.id } }, as: :json
    end
    assert_response :accepted
    run = ProfileRun.find(response.parsed_body.dig("profile_run", "id"))
    assert_equal @reporter.id, run.user_id
  end

  private

  def login(user)
    post "/api/session", params: { email: user.email, password: "Learning123!" }, as: :json
    assert_response :success
  end
end

class ProfileOwnershipJobTest < ActiveSupport::TestCase
  include ActionCable::TestHelper
  include ProfileOwnershipFixtures

  setup do
    @owner = create_owner("profile-retention-owner@example.test")
    @other = create_owner("profile-retention-other@example.test")
  end

  test "a completed job prunes only its owner's history and preserves all unfinished runs" do
    existing = [@owner, @other].to_h { |owner| [owner.id, ProfileRun::KEEP_COMPLETED.times.map { create_run(owner) }] }
    unfinished = [@owner, @other].flat_map { |owner| %w[pending processing failed].map { |status| create_run(owner, status) } }

    [@owner, @other].each do |owner|
      other = owner == @owner ? @other : @owner
      other_ids = ProfileRun.where(user_id: other.id).order(:id).pluck(:id)
      run = create_run(owner, "pending")
      assert_no_broadcasts("infrastructure_inspections") do
        assert_no_broadcasts("infrastructure_profiles_#{other.id}") do
          assert_broadcast_on("infrastructure_profiles_#{owner.id}", { type: "profile.updated", id: run.id, status: "completed" }) do
            ProfileJob.perform_now(run.id, run.generation)
          end
        end
      end
      assert_equal "completed", run.reload.status
      assert_equal existing.fetch(owner.id).drop(1).map(&:id) + [run.id], ProfileRun.where(user_id: owner.id, status: "completed").order(:id).pluck(:id)
      assert_equal other_ids, ProfileRun.where(user_id: other.id).order(:id).pluck(:id)
      unfinished.each { |pending| assert_equal pending.status, pending.reload.status }
    end
  end

  test "failed job notifications stay private to the owner" do
    run = ProfileRun.create!(user: @owner, asset_snapshot: [])
    assert_no_broadcasts("infrastructure_inspections") do
      assert_no_broadcasts("infrastructure_profiles_#{@other.id}") do
        assert_broadcast_on("infrastructure_profiles_#{@owner.id}", { type: "profile.updated", id: run.id, status: "failed" }) do
          ProfileJob.perform_now(run.id, run.generation)
        end
      end
    end
    assert_equal "failed", run.reload.status
  end

  test "an unknown legacy owner never triggers pruning or a public profile notification" do
    21.times { create_run(@owner) }
    original_ids = ProfileRun.order(:id).pluck(:id)
    assert_equal 0, ProfileRun.prune_completed!(user_id: nil)
    assert_equal original_ids, ProfileRun.order(:id).pluck(:id)
    legacy = ProfileRun.new(id: 123, user_id: nil, status: "completed")
    broadcasts = []
    original = ActionCable.server.method(:broadcast)
    ActionCable.server.define_singleton_method(:broadcast) { |*args| broadcasts << args }
    ProfileJob.new.send(:broadcast, legacy)
    assert_empty broadcasts
  ensure
    ActionCable.server.define_singleton_method(:broadcast, original) if original
  end
end

class ProfileOwnershipChannelTest < ActionCable::Channel::TestCase
  tests InspectionChannel
  include ProfileOwnershipFixtures

  test "subscription uses the authenticated owner while preserving shared inspections" do
    owner = create_owner("profile-channel-owner@example.test")
    other = create_owner("profile-channel-other@example.test", "staff")
    stub_connection current_user: owner
    subscribe(user_id: other.id, viewer: other.id)
    assert subscription.confirmed?
    assert_has_stream "infrastructure_inspections"
    assert_has_stream "infrastructure_profiles_#{owner.id}"
    assert_equal 2, subscription.streams.length
    assert_not_includes subscription.streams, "infrastructure_profiles_#{other.id}"
  end
end
