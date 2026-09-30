class TelemetryRecorder
  HISTORY_LIMIT = 360
  EVENT_LIMIT = 500

  def self.record!(vehicle:, sequence:, longitude:, latitude:, speed_kph: 0, captured_at: Time.current)
    sequence = Integer(sequence.to_s, 10)
    longitude = Float(longitude)
    latitude = Float(latitude)
    speed_kph = Float(speed_kph)
    raise ArgumentError, "Invalid telemetry coordinates or speed" unless longitude.finite? && latitude.finite? && speed_kph.finite? &&
      longitude.between?(-180, 180) && latitude.between?(-90, 90) && speed_kph.between?(0, 250) && sequence >= 0

    accepted = false
    vehicle.with_lock do
      return false if sequence <= vehicle.last_sequence

      vehicle.update!(longitude: longitude, latitude: latitude, speed_kph: speed_kph, last_sequence: sequence, captured_at: captured_at)
      Vehicle.connection.execute(Vehicle.sanitize_sql_array([
        "INSERT INTO telemetry_points (vehicle_id,sequence,longitude,latitude,speed_kph,captured_at,geom) VALUES (?,?,?,?,?,?,ST_SetSRID(ST_MakePoint(?,?),4326))",
        vehicle.id, sequence, longitude, latitude, speed_kph, captured_at, longitude, latitude
      ]))
      Geofence.order(:id).each do |fence|
        inside = Geofence.connection.select_value(Geofence.sanitize_sql_array([
          "SELECT ST_Covers(geom,ST_SetSRID(ST_MakePoint(?,?),4326)) FROM geofences WHERE id = ?", longitude, latitude, fence.id
        ]))
        membership = GeofenceMembership.find_or_initialize_by(vehicle: vehicle, geofence: fence)
        previous = membership.inside || false
        if inside != previous
          GeofenceEvent.create!(vehicle: vehicle, geofence: fence, sequence: sequence, transition: inside ? "entered" : "exited", captured_at: captured_at)
        end
        membership.update!(inside: inside)
      end
      old_ids = vehicle.telemetry_points.order(sequence: :desc).offset(HISTORY_LIMIT).pluck(:id)
      TelemetryPoint.where(id: old_ids).delete_all if old_ids.any?
      stale_events = GeofenceEvent.order(id: :desc).offset(EVENT_LIMIT).pluck(:id)
      GeofenceEvent.where(id: stale_events).delete_all if stale_events.any?
      accepted = true
    end
    accepted
  end
end
