class ProfileRun < ApplicationRecord
  belongs_to :user
  validates :status, inclusion: { in: %w[pending processing completed failed] }

  def payload
    as_json(only: %i[id status generation summary error_message completed_at created_at]).merge("source" => "Synthetic asset elevations; linear interpolation; not a DEM")
  end

  def document
    {
      type: "FeatureCollection", name: "synthetic-corridor-profile-#{id}",
      metadata: { source: "SYNTHETIC DATA: linearly interpolated asset base elevations, not a surveyed terrain model", summary: summary, assets: asset_snapshot },
      features: samples.map { |sample| { type: "Feature", properties: { distance_m: sample["distance_m"], synthetic_elevation_m: sample["elevation_m"] }, geometry: { type: "Point", coordinates: [sample["longitude"], sample["latitude"], sample["elevation_m"]] } } }
    }
  end
end
