require "test_helper"

class FleetDomainTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    GeofenceEvent.delete_all
    GeofenceMembership.delete_all
    TelemetryPoint.delete_all
    Vehicle.delete_all
    Geofence.delete_all
    ReplayControl.delete_all
    clear_enqueued_jobs
    @vehicle = Vehicle.create!(name: "Test unit", registration: "TEST-001", color: "#06b6d4", route: [[-1.1, 0], [0, 0], [0.5, 0], [1.1, 0]])
    @fence = Geofence.create!(name: "Test zone", color: "#8b5cf6", coordinates: [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]])
  end

  test "PostGIS boundary is inside and events are emitted only on transitions" do
    record(1, -1.1)
    assert_equal 0, GeofenceEvent.count
    record(2, -1.0)
    assert_equal ["entered"], GeofenceEvent.pluck(:transition)
    record(3, 0)
    record(4, 1.0)
    assert_equal 1, GeofenceEvent.count
    record(5, 1.1)
    assert_equal %w[entered exited], GeofenceEvent.order(:sequence).pluck(:transition)
    record(6, 1.2)
    assert_equal 2, GeofenceEvent.count
    assert_equal false, GeofenceMembership.find_by!(vehicle: @vehicle, geofence: @fence).inside
  end

  test "first inside fix emits entry and duplicate or out of order telemetry is ignored" do
    assert record(8, 0)
    assert_not record(8, 2)
    assert_not record(7, 2)
    assert_equal 1, TelemetryPoint.count
    assert_equal 1, GeofenceEvent.count
    assert_equal 0, @vehicle.reload.longitude
    assert_equal 8, @vehicle.last_sequence
  end

  test "bad telemetry is rejected without a partial record" do
    assert_raises(ArgumentError) { record(1, 181) }
    assert_raises(ArgumentError) { record(-1, 0) }
    assert_raises(ArgumentError) { record(1, Float::NAN) }
    assert_raises(ArgumentError) { record(1.5, 0) }
    assert_equal 0, TelemetryPoint.count
    assert_equal(-1, @vehicle.reload.last_sequence)
  end

  test "telemetry geometry uses WGS84 and recent trail retention is bounded" do
    @fence.destroy!
    (TelemetryRecorder::HISTORY_LIMIT + 2).times { |i| record(i + 1, 0) }
    assert_equal TelemetryRecorder::HISTORY_LIMIT, TelemetryPoint.count
    assert_equal 3, TelemetryPoint.minimum(:sequence)
    assert_equal 4326, TelemetryPoint.connection.select_value("SELECT ST_SRID(geom) FROM telemetry_points LIMIT 1")
  end

  test "intersecting and degenerate polygons cannot be persisted" do
    invalid = Geofence.new(name: "Crossing", coordinates: [[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]])
    assert_not invalid.valid?
    assert_includes invalid.errors[:coordinates].join, "non-intersecting"
    @fence.coordinates = [[0, 0], [1, 0], [2, 0], [0, 0]]
    assert_not @fence.valid?
  end

  test "starting twice schedules exactly one replay chain and duplicate tick is a no-op" do
    control = ReplayEngine.control!("start")
    generation = control.generation
    ReplayEngine.control!("start")
    assert_equal 1, enqueued_jobs.length
    assert ReplayEngine.advance!(generation, 0)
    assert_equal 1, ReplayControl.instance.cursor
    assert_equal 2, enqueued_jobs.length
    assert_not ReplayEngine.advance!(generation, 0)
    assert_equal 1, ReplayControl.instance.cursor
    assert_equal 2, enqueued_jobs.length
  end

  test "paused and reset generations cannot advance the simulation" do
    first = ReplayEngine.control!("start")
    first_generation = first.generation
    ReplayEngine.control!("pause")
    assert_not ReplayEngine.advance!(first_generation, 0)
    next_control = ReplayEngine.control!("start")
    assert_operator next_control.generation, :>, first_generation
    assert ReplayEngine.advance!(next_control.generation, 0)
    ReplayEngine.control!("reset")
    assert_not ReplayEngine.advance!(next_control.generation, 1)
    assert_equal 0, ReplayControl.instance.cursor
    assert_not ReplayControl.instance.running?
    assert_nil @vehicle.reload.longitude
    assert_equal 0, TelemetryPoint.count
    assert_equal 0, GeofenceEvent.count
    assert_equal 0, GeofenceMembership.count
  end

  test "higher speed processes intermediate points and retains both entry and exit" do
    ReplayEngine.control!("speed", speed: 4)
    control = ReplayEngine.control!("start")
    ReplayControlJob.perform_now(control.generation, 0)
    assert_equal 4, ReplayControl.instance.cursor
    assert_equal 4, TelemetryPoint.count
    assert_equal %w[entered exited], GeofenceEvent.order(:sequence).pluck(:transition)
    assert_raises(ActiveRecord::RecordInvalid) { ReplayEngine.control!("speed", speed: 3) }
    assert_equal 4, ReplayControl.instance.speed
  end

  test "cancelled scheduling rolls back both start and the next telemetry frame" do
    reject = -> { throw(:abort) }
    ReplayControlJob.set_callback(:enqueue, :before, reject)
    assert_raises(ActiveJob::EnqueueError) { ReplayEngine.control!("start") }
    assert_not ReplayControl.instance.running?
    ReplayControlJob.skip_callback(:enqueue, :before, reject)

    control = ReplayEngine.control!("start")
    ReplayControlJob.set_callback(:enqueue, :before, reject)
    assert_raises(ActiveJob::EnqueueError) { ReplayEngine.advance!(control.generation, 0) }
    assert_equal 0, ReplayControl.instance.cursor
    assert_equal 0, TelemetryPoint.count
    assert_equal(-1, @vehicle.reload.last_sequence)
  ensure
    ReplayControlJob.skip_callback(:enqueue, :before, reject, raise: false)
  end

  test "notification failure cannot turn a committed replay command into an error" do
    original = ActionCable.server.method(:broadcast)
    ActionCable.server.define_singleton_method(:broadcast) { |*| raise IOError, "Notification transport unavailable" }
    replay = ReplayEngine.control!("start")
    assert replay.running?
    assert_equal 1, enqueued_jobs.length
    assert ReplayEngine.advance!(replay.generation, 0)
    assert_equal 1, ReplayControl.instance.cursor
    assert_equal 2, enqueued_jobs.length
  ensure
    ActionCable.server.define_singleton_method(:broadcast, original)
  end

  test "recording a position takes the same number of statements however many geofences exist" do
    record(1, 5)
    with_one = statements { record(2, 5) }
    3.times { |i| Geofence.create!(name: "Extra #{i}", coordinates: [[10 + i, 10], [11 + i, 10], [11 + i, 11], [10 + i, 11], [10 + i, 10]]) }
    record(3, 5)
    with_four = statements { record(4, 5) }
    assert_equal with_one, with_four
    assert_equal 4, GeofenceMembership.where(vehicle: @vehicle, inside: false).count
  end

  test "a replay frame measures every vehicle's segment in one query" do
    second = Vehicle.create!(name: "Second unit", registration: "TEST-002", color: "#f97316", route: [[0, 0], [0.001, 0]])
    replay = ReplayEngine.control!("start")
    distance_queries = 0
    counter = ->(*, payload) { distance_queries += 1 if payload[:sql].include?("ST_Distance") }
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { ReplayEngine.advance!(replay.generation, 0) }
    assert_equal 1, distance_queries
    # The first frame moves from the last route point to the first. For the second unit that is
    # 0.001 degrees of longitude at the equator, 111.3 m in a 10-second frame.
    assert_in_delta 111.32 / 10 * 3.6, second.reload.speed_kph, 0.05
    assert_equal 250, @vehicle.reload.speed_kph, "2.2 degrees in one frame is capped at 250 km/h"
  end

  private

  def record(sequence, longitude)
    TelemetryRecorder.record!(vehicle: @vehicle, sequence: sequence, longitude: longitude, latitude: 0)
  end

  def statements
    count = 0
    counter = ->(*, payload) { count += 1 unless %w[SCHEMA TRANSACTION].include?(payload[:name]) }
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end
end

class FleetPermissionsTest < ActionDispatch::IntegrationTest
  setup do
    @observer = User.find_or_create_by!(email: "fleet-observer@example.test") { |u| u.name = "Observer"; u.role = "reporter"; u.password = "Learning123!" }
    @staff = User.find_or_create_by!(email: "fleet-staff@example.test") { |u| u.name = "Operator"; u.role = "staff"; u.password = "Learning123!" }
  end

  test "anonymous access is rejected and observers can read but cannot control replay" do
    get "/api/fleet"
    assert_response :unauthorized
    post "/api/session", params: { email: @observer.email, password: "Learning123!" }, as: :json
    assert_response :success
    get "/api/fleet"
    assert_response :success
    assert_equal true, response.parsed_body["replay"]["simulation"]
    post "/api/fleet/control", params: { action_name: "start" }, as: :json
    assert_response :forbidden
    post "/api/geofences", params: { geofence: { name: "Unauthorized" } }, as: :json
    assert_response :forbidden
  end

  test "staff controls replay and receives validation errors for unsupported speed" do
    post "/api/session", params: { email: @staff.email, password: "Learning123!" }, as: :json
    post "/api/fleet/control", params: { action_name: "speed", speed: 2 }, as: :json
    assert_response :success
    assert_equal 2, response.parsed_body["replay"]["speed"]
    post "/api/fleet/control", params: { action_name: "speed", speed: 8 }, as: :json
    assert_response :unprocessable_entity
    post "/api/fleet/control", params: { action_name: "speed", speed: 2.5 }, as: :json
    assert_response :unprocessable_entity
    post "/api/fleet/control", params: { action_name: "missing" }, as: :json
    assert_response :unprocessable_entity
  end

  test "manual telemetry requires staff and paused replay, then discards stale data" do
    vehicle = Vehicle.create!(name: "Integration unit", registration: "INTEGRATION-1", color: "#06b6d4", route: [[0, 0], [1, 0]])
    post "/api/session", params: { email: @observer.email, password: "Learning123!" }, as: :json
    post "/api/vehicles/#{vehicle.id}/telemetry", params: { sequence: 10, longitude: 0, latitude: 0 }, as: :json
    assert_response :forbidden
    post "/api/session", params: { email: @staff.email, password: "Learning123!" }, as: :json
    ReplayControl.instance.update!(running: true)
    post "/api/vehicles/#{vehicle.id}/telemetry", params: { sequence: 10, longitude: 0, latitude: 0 }, as: :json
    assert_response :conflict
    ReplayControl.instance.update!(running: false)
    post "/api/vehicles/#{vehicle.id}/telemetry", params: { sequence: 10, longitude: 0, latitude: 0 }, as: :json
    assert_response :success
    assert_equal true, response.parsed_body["accepted"]
    post "/api/vehicles/#{vehicle.id}/telemetry", params: { sequence: 9, longitude: 1, latitude: 0 }, as: :json
    assert_response :success
    assert_equal false, response.parsed_body["accepted"]
    get "/api/vehicles/#{vehicle.id}/history"
    assert_response :success
    assert_equal 1, response.parsed_body["points"].length
  end

  test "a rejected replay enqueue returns a retryable response without starting replay" do
    post "/api/session", params: { email: @staff.email, password: "Learning123!" }, as: :json
    assert_response :success
    ReplayControl.instance.update!(running: false)
    reject = -> { throw(:abort) }
    ReplayControlJob.set_callback(:enqueue, :before, reject)
    post "/api/fleet/control", params: { action_name: "start" }, as: :json
    assert_response :service_unavailable
    assert_not ReplayControl.instance.running?
    assert_match(/could not be queued/, response.parsed_body["error"])
  ensure
    ReplayControlJob.skip_callback(:enqueue, :before, reject, raise: false) if reject
  end

  test "staff can create and delete a valid geofence through the API" do
    post "/api/session", params: { email: @staff.email, password: "Learning123!" }, as: :json
    post "/api/geofences", params: { geofence: { name: "API zone", coordinates: [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]] } }, as: :json
    assert_response :created
    id = response.parsed_body["geofence"]["id"]
    assert Geofence.connection.select_value("SELECT geom IS NOT NULL FROM geofences WHERE id = #{Integer(id)}")
    delete "/api/geofences/#{id}"
    assert_response :no_content
    assert_not Geofence.exists?(id)
  end
end
