class GeofenceEvent < ApplicationRecord
  belongs_to :vehicle
  belongs_to :geofence
  validates :transition, inclusion: { in: %w[entered exited] }

  def payload
    as_json(only: %i[id vehicle_id geofence_id transition sequence captured_at]).merge(
      "vehicle_name" => vehicle.name, "geofence_name" => geofence.name
    )
  end
end
