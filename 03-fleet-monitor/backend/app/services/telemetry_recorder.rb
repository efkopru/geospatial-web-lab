class TelemetryRecorder
  HISTORY_LIMIT = 360
  EVENT_LIMIT = 500
  # Sequences are stored in 32-bit integer columns.
  MAX_SEQUENCE = 2_147_483_647
  # Manual telemetry may set the replay's sequence, so it leaves the replay at least a million
  # further sequence numbers (about 69 hours at 4x speed) before it has to stop.
  MAX_MANUAL_SEQUENCE = MAX_SEQUENCE - 1_000_000

  def self.record!(vehicle:, sequence:, longitude:, latitude:, speed_kph: 0, captured_at: Time.current, max_sequence: MAX_SEQUENCE)
    sequence = Integer(sequence.to_s, 10)
    raise ArgumentError, "Sequence must be an integer from 0 to #{max_sequence}" unless sequence.between?(0, max_sequence)
    longitude = Float(longitude)
    latitude = Float(latitude)
    speed_kph = Float(speed_kph)
    raise ArgumentError, "Invalid telemetry coordinates or speed" unless longitude.finite? && latitude.finite? && speed_kph.finite? &&
      longitude.between?(-180, 180) && latitude.between?(-90, 90) && speed_kph.between?(0, 250)

    accepted = false
    vehicle.with_lock do
      return false if sequence <= vehicle.last_sequence

      vehicle.update!(longitude: longitude, latitude: latitude, speed_kph: speed_kph, last_sequence: sequence, captured_at: captured_at)
      Vehicle.connection.execute(Vehicle.sanitize_sql_array([
        "INSERT INTO telemetry_points (vehicle_id,sequence,longitude,latitude,speed_kph,captured_at,geom) VALUES (?,?,?,?,?,?,ST_SetSRID(ST_MakePoint(?,?),4326))",
        vehicle.id, sequence, longitude, latitude, speed_kph, captured_at, longitude, latitude
      ]))
      transitions = record_memberships(vehicle, sequence, longitude, latitude, captured_at)
      # Each limit is enforced with a single DELETE. The event log only grows on a transition.
      TelemetryPoint.where(vehicle_id: vehicle.id, id: TelemetryPoint.where(vehicle_id: vehicle.id).order(sequence: :desc).offset(HISTORY_LIMIT).select(:id)).delete_all
      GeofenceEvent.where(id: GeofenceEvent.order(id: :desc).offset(EVENT_LIMIT).select(:id)).delete_all if transitions.positive?
      accepted = true
    end
    accepted
  end

  # Tests the position against every geofence in one query, records an event for each entry or
  # exit, and writes only memberships that are new or changed. Returns the number of events.
  def self.record_memberships(vehicle, sequence, longitude, latitude, captured_at)
    covers = Geofence.sanitize_sql_array(["ST_Covers(geom,ST_SetSRID(ST_MakePoint(?,?),4326)) AS covers_position", longitude, latitude])
    memberships = GeofenceMembership.where(vehicle_id: vehicle.id).index_by(&:geofence_id)
    transitions = 0
    Geofence.select(:id, covers).order(:id).each do |fence|
      inside = fence.covers_position
      membership = memberships[fence.id] || GeofenceMembership.new(vehicle: vehicle, geofence: fence)
      if inside != (membership.inside || false)
        GeofenceEvent.create!(vehicle: vehicle, geofence: fence, sequence: sequence, transition: inside ? "entered" : "exited", captured_at: captured_at)
        transitions += 1
      end
      membership.update!(inside: inside)
    end
    transitions
  end
  private_class_method :record_memberships
end
