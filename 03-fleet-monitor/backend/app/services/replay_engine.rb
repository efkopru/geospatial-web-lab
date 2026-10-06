class ReplayEngine
  FRAME_SECONDS = 10

  def self.control!(action, speed: nil)
    replay = ReplayControl.instance
    replay.with_lock do
      case action
      when "start"
        unless replay.running?
          replay.update!(running: true, generation: replay.generation + 1)
          enqueue!(replay.generation, replay.cursor)
        end
      when "pause"
        replay.update!(running: false, generation: replay.generation + 1) if replay.running?
      when "reset"
        replay.update!(running: false, cursor: 0, sequence: 0, generation: replay.generation + 1)
        GeofenceEvent.delete_all
        GeofenceMembership.delete_all
        TelemetryPoint.delete_all
        Vehicle.update_all(longitude: nil, latitude: nil, speed_kph: 0, captured_at: nil, last_sequence: -1)
      when "speed"
        replay.update!(speed: Integer(speed.to_s, 10))
      else
        raise ArgumentError, "Unknown replay action"
      end
    end
    broadcast!
    replay
  end

  def self.advance!(generation, expected_cursor)
    replay = ReplayControl.instance
    continue_replay = false
    replay.with_lock do
      return false unless replay.running? && replay.generation == generation && replay.cursor == expected_cursor

      # Routes do not change during a replay; TelemetryRecorder re-reads each vehicle under its lock.
      vehicles = Vehicle.order(:id).select { |vehicle| vehicle.route.length >= 2 }
      replay.speed.times do
        next_sequence = replay.sequence + 1
        moves = vehicles.map do |vehicle|
          route = vehicle.route
          index = (replay.cursor + vehicle.route_offset) % route.length
          [vehicle, route[(index - 1) % route.length], route[index]]
        end
        distances = segment_lengths(moves.map { |_, previous, point| [previous, point] })
        moves.zip(distances) do |(vehicle, _, point), distance_m|
          TelemetryRecorder.record!(vehicle: vehicle, sequence: next_sequence, longitude: point[0], latitude: point[1],
            speed_kph: [distance_m / FRAME_SECONDS * 3.6, 250].min, captured_at: Time.current)
        end
        replay.update!(cursor: replay.cursor + 1, sequence: next_sequence)
      end
      enqueue!(generation, replay.cursor, wait: 1.second)
      continue_replay = true
    end
    broadcast! if continue_replay
    continue_replay
  end

  # Geodesic lengths in metres of [[from, to], ...] longitude/latitude segments, in one query.
  def self.segment_lengths(segments)
    return [] if segments.empty?
    rows = segments.each_with_index.map do |(from, to), index|
      Vehicle.sanitize_sql_array(["(?, ?::float8, ?::float8, ?::float8, ?::float8)", index, from[0], from[1], to[0], to[1]])
    end
    Vehicle.connection.select_values(<<~SQL).map(&:to_f)
      SELECT ST_Distance(ST_SetSRID(ST_MakePoint(x1, y1), 4326)::geography, ST_SetSRID(ST_MakePoint(x2, y2), 4326)::geography)
      FROM (VALUES #{rows.join(", ")}) AS segment(n, x1, y1, x2, y2) ORDER BY n
    SQL
  end

  def self.broadcast!
    ActionCable.server.broadcast("fleet_replay", { type: "fleet.updated", sequence: ReplayControl.instance.sequence })
  rescue StandardError => error
    # Committed telemetry remains authoritative; browsers also poll current state.
    Rails.logger.warn("Fleet notification failed: #{error.class}: #{error.message}")
  end

  def self.enqueue!(generation, cursor, wait: nil)
    job = ReplayControlJob.set(wait: wait).perform_later(generation, cursor)
    raise ActiveJob::EnqueueError, "Replay could not be queued" unless job && job.successfully_enqueued?
  end
end
