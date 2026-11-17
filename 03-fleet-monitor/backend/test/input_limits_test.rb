require "test_helper"

# Unusual input answers with a plain message, not a server error or a Ruby error message.
class FleetInputLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @staff = User.create!(email: "limits-staff@example.test", name: "Limits operator", password: "Learning123!", role: "staff")
    @vehicle = Vehicle.create!(name: "Limits unit", registration: "LIMITS-1", color: "#06b6d4", route: [[0, 0], [1, 0]])
    post "/api/session", params: { email: @staff.email, password: "Learning123!" }, as: :json
    assert_response :success
  end

  def zone(**attributes)
    { geofence: { name: "Limits zone", color: "#112233", coordinates: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]] }.merge(attributes) }
  end

  test "malformed zone coordinates are rejected with the validation message" do
    ["abc", 7, { a: 1 }, [[0, 0], "pair", [0.01, 0.01], [0, 0]], [[0, 0], [0.01, { x: 1 }], [0.01, 0.01], [0, 0]], [[0, 0], [0.01, "east"], [0.01, 0.01], [0, 0]]].each do |coordinates|
      assert_no_difference("Geofence.count") { post "/api/geofences", params: zone(coordinates: coordinates), as: :json }
      assert_response :unprocessable_entity
      assert_equal "Coordinates must be a closed polygon ring of 4 to 200 valid longitude/latitude pairs", response.parsed_body["error"]
    end
    assert_no_difference("Geofence.count") { post "/api/geofences", params: { geofence: "zone" }, as: :json }
    assert_response :bad_request
    assert_equal "geofence must be an object", response.parsed_body["error"]
    assert_difference("Geofence.count", 1) { post "/api/geofences", params: zone(coordinates: [["0", "0"], [0.01, 0], [0.01, 0.01], ["0", "0"]]), as: :json }
    assert_response :created
  end

  test "a zone name with a NUL character is refused" do
    assert_no_difference("Geofence.count") { post "/api/geofences", params: zone(name: "Bad\u0000zone"), as: :json }
    assert_response :unprocessable_entity
    assert_equal "The parameter geofence.name contains the NUL character (\\u0000), which cannot be stored. Remove it and try again.", response.parsed_body["error"]
  end

  test "replay speed and manual telemetry report plain messages for values that are not numbers" do
    [{ a: 1 }, "fast", 2.5, nil].each do |speed|
      post "/api/fleet/control", params: { action_name: "speed", speed: speed }, as: :json
      assert_response :unprocessable_entity
      assert_equal "Replay speed must be 1, 2 or 4", response.parsed_body["error"]
    end
    [{ sequence: "next", longitude: 0, latitude: 0 }, { sequence: { a: 1 }, longitude: 0, latitude: 0 }].each do |telemetry|
      post "/api/vehicles/#{@vehicle.id}/telemetry", params: telemetry, as: :json
      assert_response :unprocessable_entity
      assert_equal "Sequence must be an integer from 0 to #{TelemetryRecorder::MAX_MANUAL_SEQUENCE}", response.parsed_body["error"]
    end
    [{ sequence: 1, longitude: "east", latitude: 0 }, { sequence: 1, longitude: 0, latitude: { a: 1 } }, { sequence: 1, longitude: 0, latitude: 0, speed_kph: [1] }].each do |telemetry|
      post "/api/vehicles/#{@vehicle.id}/telemetry", params: telemetry, as: :json
      assert_response :unprocessable_entity
      assert_equal "Invalid telemetry coordinates or speed", response.parsed_body["error"]
    end
    assert_equal [-1, 0], [@vehicle.reload.last_sequence, @vehicle.telemetry_points.count]
  end
end
