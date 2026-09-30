class Vehicle < ApplicationRecord
  has_many :telemetry_points, dependent: :delete_all
  has_many :geofence_memberships, dependent: :delete_all
  has_many :geofence_events, dependent: :delete_all
  validates :name, :registration, :color, presence: true
  validates :registration, uniqueness: true
  validates :route, length: { minimum: 2 }

  def payload
    as_json(only: %i[id name registration color longitude latitude speed_kph last_sequence captured_at])
      .merge("inside_geofences" => geofence_memberships.select(&:inside).map(&:geofence_id))
  end
end
