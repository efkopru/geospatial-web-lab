class CorridorProfile
  def self.build(assets)
    raise ArgumentError, "At least two assets are required for a corridor profile" if assets.length < 2
    distance = 0.0
    samples = []
    assets.each_cons(2) do |first, second|
      segment = InfrastructureAsset.connection.select_all(InfrastructureAsset.sanitize_sql_array([
        <<~SQL,
          WITH endpoints AS (
            SELECT ST_SetSRID(ST_MakePoint(?,?),4326)::geography AS first,
              ST_SetSRID(ST_MakePoint(?,?),4326)::geography AS last
          ), measurements AS (
            SELECT first, ST_Distance(first,last) AS length_m,
              ST_Azimuth(first,last) AS azimuth FROM endpoints
          ), samples AS (
            SELECT n, length_m, CASE WHEN length_m = 0 THEN first
              ELSE ST_Project(first,length_m * n / 10.0,azimuth) END::geometry AS point
            FROM measurements CROSS JOIN generate_series(0,9) AS n
          )
          SELECT length_m, ST_X(point) AS longitude, ST_Y(point) AS latitude FROM samples ORDER BY n
        SQL
        first.fetch("longitude"), first.fetch("latitude"), second.fetch("longitude"), second.fetch("latitude")
      ])).to_a
      segment_length = segment.first.fetch("length_m").to_f
      segment.each_with_index do |point, index|
        ratio = index / 10.0
        samples << {
          "distance_m" => (distance + segment_length * ratio).round(2),
          "longitude" => point.fetch("longitude"),
          "latitude" => point.fetch("latitude"),
          "elevation_m" => (first.fetch("ground_elevation_m") + (second.fetch("ground_elevation_m") - first.fetch("ground_elevation_m")) * ratio).round(2)
        }
      end
      distance += segment_length
    end
    last = assets.last
    samples << { "distance_m" => distance.round(2), "longitude" => last.fetch("longitude"), "latitude" => last.fetch("latitude"), "elevation_m" => last.fetch("ground_elevation_m") }
    summary = { "length_m" => distance.round(2), "min_ground_m" => samples.map { |s| s["elevation_m"] }.min,
      "max_ground_m" => samples.map { |s| s["elevation_m"] }.max, "max_top_m" => assets.map { |a| a.fetch("ground_elevation_m") + a.fetch("structure_height_m") }.max,
      "asset_count" => assets.length, "sample_count" => samples.length }
    { samples: samples, summary: summary }
  end
end
