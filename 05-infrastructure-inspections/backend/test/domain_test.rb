require "test_helper"

class InfrastructureDomainTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = User.create!(name: "Test inspector", email: "profile-test@example.test", role: "reporter", password: "Learning123!")
    @first = InfrastructureAsset.create!(asset_code: "TEST-A", name: "First tower", kind: "tower", longitude: -105.28, latitude: 39.98, ground_elevation_m: 1600, structure_height_m: 30, corridor_order: 0)
    @second = InfrastructureAsset.create!(asset_code: "TEST-B", name: "Second pole", kind: "pole", longitude: -105.27, latitude: 39.98, ground_elevation_m: 1620, structure_height_m: 20, corridor_order: 1)
  end

  test "3D geometry stores base elevation and computed top adds structure height" do
    assert_equal 1630, @first.payload["top_elevation_m"]
    z = InfrastructureAsset.connection.select_value("SELECT ST_Z(geom) FROM infrastructure_assets WHERE id=#{@first.id}")
    assert_equal 1600, z
    @first.update!(structure_height_m: 40)
    assert_equal 1640, @first.payload["top_elevation_m"]
    @first.longitude = 181
    assert_not @first.valid?
  end

  test "inspection rejects invalid severity short notes future observations and blank resolution" do
    inspection = @first.inspections.new(author: @user, severity: "urgent", notes: "Short", observed_at: 1.day.from_now)
    assert_not inspection.valid?
    assert_includes inspection.errors.attribute_names, :severity
    assert_includes inspection.errors.attribute_names, :notes
    assert_includes inspection.errors.attribute_names, :observed_at
    inspection.assign_attributes(severity: "high", notes: "A valid synthetic observation.", observed_at: Time.current, status: "resolved")
    assert_not inspection.valid?
    assert_includes inspection.errors.attribute_names, :resolution_notes
  end

  test "creating an observation also creates its immutable initial history entry" do
    inspection = @first.inspections.create!(author: @user, severity: "low", notes: "Synthetic fitting needs inspection.", observed_at: Time.current)
    assert_equal 1, inspection.inspection_events.count
    assert_equal "reported", inspection.inspection_events.first.action
    assert_equal @user, inspection.inspection_events.first.actor
    assert_equal 1, @first.payload["open_inspections"]
  end

  test "profile uses PostGIS distance and interpolates endpoints without changing the source snapshot" do
    snapshot = [@first.payload, @second.payload]
    result = CorridorProfile.build(snapshot)
    assert_equal 11, result[:samples].length
    assert_equal 1600, result[:samples].first["elevation_m"]
    assert_equal 1620, result[:samples].last["elevation_m"]
    assert_equal 1610, result[:samples][5]["elevation_m"]
    assert_in_delta 854, result[:summary]["length_m"], 5
    assert_equal 1640, result[:summary]["max_top_m"]
    @first.update!(ground_elevation_m: 1900)
    assert_equal 1600, CorridorProfile.build(snapshot)[:samples].first["elevation_m"]
  end

  test "profile jobs complete durably and duplicate completed jobs are no-ops" do
    run = ProfileRun.create!(user: @user, asset_snapshot: [@first.payload, @second.payload])
    ProfileJob.perform_now(run.id, 0)
    assert_equal "completed", run.reload.status
    assert_equal 11, run.samples.length
    timestamp = run.completed_at
    ProfileJob.perform_now(run.id, 0)
    assert_equal timestamp, run.reload.completed_at
    assert_equal "FeatureCollection", run.document[:type]
    assert_match(/SYNTHETIC/, run.document[:metadata][:source])
  end

  test "profile stationing and coordinates follow the same short geodesic across the dateline" do
    snapshot = [@first.payload.merge("longitude" => 179.9, "latitude" => 0), @second.payload.merge("longitude" => -179.9, "latitude" => 0)]
    result = CorridorProfile.build(snapshot)
    assert_in_delta 22_264, result[:summary]["length_m"], 5
    assert result[:samples].all? { |point| point["longitude"].abs >= 179.9 }, "Samples must remain near the dateline"
    assert_in_delta 180, result[:samples][5]["longitude"].abs, 0.000001
    assert_equal 1610, result[:samples][5]["elevation_m"]
  end

  test "coincident assets produce finite profile samples" do
    result = CorridorProfile.build([@first.payload, @second.payload.merge("longitude" => @first.longitude, "latitude" => @first.latitude)])
    assert_equal 0, result[:summary]["length_m"]
    assert result[:samples].all? { |point| point["longitude"].finite? && point["latitude"].finite? }
    assert_equal 1620, result[:samples].last["elevation_m"]
  end

  test "profile processing completes when live notifications are unavailable" do
    run = ProfileRun.create!(user: @user, asset_snapshot: [@first.payload, @second.payload])
    original = ActionCable.server.method(:broadcast)
    ActionCable.server.define_singleton_method(:broadcast) { |*| raise IOError, "Notification transport unavailable" }
    ProfileJob.perform_now(run.id, run.generation)
    assert_equal "completed", run.reload.status
    assert_nil run.error_message
    assert_equal 11, run.samples.length
  ensure
    ActionCable.server.define_singleton_method(:broadcast, original)
  end

  test "bad snapshots fail visibly and old generations cannot replace a retried result" do
    run = ProfileRun.create!(user: @user, asset_snapshot: [])
    ProfileJob.perform_now(run.id, 0)
    assert_equal "failed", run.reload.status
    assert_match(/Retry this run/, run.error_message)
    run.update!(generation: 1, status: "pending", asset_snapshot: [@first.payload, @second.payload])
    ProfileJob.perform_now(run.id, 0)
    assert_equal "pending", run.reload.status
    ProfileJob.perform_now(run.id, 1)
    assert_equal "completed", run.reload.status
  end
end

class InfrastructurePermissionsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @reporter = User.create!(name: "Inspector", email: "inspection-reporter@example.test", role: "reporter", password: "Learning123!")
    @staff = User.create!(name: "Supervisor", email: "inspection-staff@example.test", role: "staff", password: "Learning123!")
    @asset = InfrastructureAsset.create!(asset_code: "API-A", name: "Test tower", kind: "tower", longitude: -105.28, latitude: 39.98, ground_elevation_m: 1600, structure_height_m: 30, corridor_order: 0)
    @second = InfrastructureAsset.create!(asset_code: "API-B", name: "Test pole", kind: "pole", longitude: -105.27, latitude: 39.98, ground_elevation_m: 1620, structure_height_m: 20, corridor_order: 1)
    clear_enqueued_jobs
  end

  test "anonymous requests are denied and reporter can add an observation without spoofing ownership" do
    get "/api/assets"
    assert_response :unauthorized
    login(@reporter)
    post "/api/assets/#{@asset.id}/inspections", params: { inspection: { severity: "high", notes: "Synthetic cross-brace has surface corrosion.", observed_at: Time.current.iso8601, author_id: @staff.id, status: "resolved" } }, as: :json
    assert_response :created
    inspection = Inspection.find(response.parsed_body["inspection"]["id"])
    assert_equal @reporter, inspection.author
    assert_equal "open", inspection.status
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "resolved", resolution_notes: "Unauthorized attempt to resolve.", lock_version: 0 } }, as: :json
    assert_response :forbidden
  end

  test "staff resolves and reopens with audited history and optimistic concurrency" do
    inspection = @asset.inspections.create!(author: @reporter, severity: "high", notes: "Synthetic connection is loose.", observed_at: Time.current)
    login(@staff)
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "resolved", resolution_notes: "Connection inspected and tightened.", lock_version: 0 } }, as: :json
    assert_response :success
    assert_equal @staff.id, inspection.reload.resolved_by_id
    assert_equal %w[reported resolved], inspection.inspection_events.order(:id).pluck(:action)
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "open", resolution_notes: "Reopen with a stale browser state.", lock_version: 0 } }, as: :json
    assert_response :conflict
    assert_equal "resolved", inspection.reload.status
    assert_equal 2, inspection.inspection_events.count
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "open", resolution_notes: "Follow-up inspection found recurrence.", lock_version: inspection.lock_version } }, as: :json
    assert_response :success
    assert_nil inspection.reload.resolved_at
    assert_equal %w[reported resolved reopened], inspection.inspection_events.order(:id).pluck(:action)
  end

  test "status updates require meaningful notes and a version" do
    inspection = @asset.inspections.create!(author: @reporter, severity: "medium", notes: "Synthetic inspection requires follow-up.", observed_at: Time.current)
    login(@staff)
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "resolved", resolution_notes: "Too short", lock_version: 0 } }, as: :json
    assert_response :unprocessable_entity
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "resolved", resolution_notes: "Sufficient resolution notes." } }, as: :json
    assert_response :bad_request
    assert_equal "open", inspection.reload.status
  end

  test "committed observations and resolutions succeed when notifications are unavailable" do
    login(@staff)
    original = ActionCable.server.method(:broadcast)
    ActionCable.server.define_singleton_method(:broadcast) { |*| raise IOError, "Notification transport unavailable" }
    post "/api/assets/#{@asset.id}/inspections", params: { inspection: { severity: "high", notes: "Synthetic fitting is damaged.", observed_at: Time.current.iso8601 } }, as: :json
    assert_response :created
    inspection = Inspection.find(response.parsed_body["inspection"]["id"])
    assert_equal 1, inspection.inspection_events.count
    patch "/api/inspections/#{inspection.id}", params: { inspection: { status: "resolved", resolution_notes: "Fitting replaced and tested.", lock_version: inspection.lock_version } }, as: :json
    assert_response :success
    assert_equal "resolved", inspection.reload.status
    assert_equal 2, inspection.inspection_events.count
  ensure
    ActionCable.server.define_singleton_method(:broadcast, original) if original
  end

  test "profile creation is queued and download waits for a completed reproducible result" do
    login(@reporter)
    assert_enqueued_with(job: ProfileJob) { post "/api/profile_runs", as: :json }
    assert_response :accepted
    run = ProfileRun.find(response.parsed_body["profile_run"]["id"])
    get "/api/profile_runs/#{run.id}/download"
    assert_response :conflict
    ProfileJob.perform_now(run.id, run.generation)
    get "/api/profile_runs/#{run.id}/download"
    assert_response :success
    document = JSON.parse(response.body)
    assert_equal "FeatureCollection", document["type"]
    assert_equal run.reload.samples.length, document["features"].length
    assert_includes response.headers["Content-Disposition"], ".geojson"
  end

  test "retry applies only to failed runs and increments its generation" do
    login(@reporter)
    run = ProfileRun.create!(user: @reporter, status: "failed", asset_snapshot: [@asset.payload, @second.payload], error_message: "Prior failure")
    post "/api/profile_runs/#{run.id}/retry", as: :json
    assert_response :accepted
    assert_equal "pending", run.reload.status
    assert_equal 1, run.generation
    assert_nil run.error_message
    post "/api/profile_runs/#{run.id}/retry", as: :json
    assert_response :conflict
  end

  test "cancelled enqueue leaves a visible retryable failure instead of a pending run" do
    login(@reporter)
    reject = -> { throw(:abort) }
    ProfileJob.set_callback(:enqueue, :before, reject)
    post "/api/profile_runs", as: :json
    assert_response :accepted
    run = ProfileRun.find(response.parsed_body["profile_run"]["id"])
    assert_equal "failed", run.status
    assert_match(/Could not queue/, run.error_message)
    ProfileJob.skip_callback(:enqueue, :before, reject)
    assert_enqueued_with(job: ProfileJob) { post "/api/profile_runs/#{run.id}/retry", as: :json }
    assert_response :accepted
    assert_equal "pending", run.reload.status
  ensure
    ProfileJob.skip_callback(:enqueue, :before, reject, raise: false)
  end

  test "an asset's detail loads in the same number of queries however many inspections it has" do
    login(@reporter)
    add_inspection = -> { @asset.inspections.create!(author: @reporter, severity: "low", notes: "Synthetic paint is flaking.", observed_at: Time.current) }
    add_inspection.call
    with_one = statements { get "/api/assets/#{@asset.id}" }
    3.times { add_inspection.call }
    with_four = statements { get "/api/assets/#{@asset.id}" }
    assert_equal with_one, with_four
    assert_equal 4, response.parsed_body["inspections"].length
    assert_equal ["reported"], response.parsed_body["inspections"].first["events"].map { |event| event["action"] }
    assert_equal "Inspector", response.parsed_body["inspections"].first["events"].first["actor_name"]
  end

  private

  def statements
    count = 0
    counter = ->(*, payload) { count += 1 unless %w[SCHEMA TRANSACTION].include?(payload[:name]) }
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end

  def login(user)
    post "/api/session", params: { email: user.email, password: "Learning123!" }, as: :json
    assert_response :success
  end
end
