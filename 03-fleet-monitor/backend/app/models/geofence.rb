class Geofence < ApplicationRecord
  has_many :geofence_memberships, dependent: :delete_all
  has_many :geofence_events, dependent: :delete_all
  validates :name, presence: true, length: { maximum: 80 }
  validates :color, format: { with: /\A#[0-9a-fA-F]{6}\z/ }
  validate :valid_polygon
  after_save :write_geometry

  def payload
    as_json(only: %i[id name color coordinates])
  end

  private

  def valid_polygon
    ring = coordinates
    unless ring.is_a?(Array) && ring.length.between?(4, 200) && ring.first == ring.last &&
        ring.all? { |p| p.is_a?(Array) && p.length == 2 && p.all? { |v| v.is_a?(Numeric) && v.finite? } && p[0].between?(-180, 180) && p[1].between?(-90, 90) }
      errors.add(:coordinates, "must be a closed polygon ring of 4 to 200 valid longitude/latitude pairs")
      return
    end
    geometry = { type: "Polygon", coordinates: [ring] }.to_json
    valid = self.class.connection.select_value(self.class.sanitize_sql_array([
      "SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(?),4326)) AND ST_Area(ST_GeomFromGeoJSON(?)) > 0", geometry, geometry
    ]))
    errors.add(:coordinates, "must form a non-intersecting polygon with positive area") unless valid
  end

  def write_geometry
    geometry = { type: "Polygon", coordinates: [coordinates] }.to_json
    self.class.connection.execute(self.class.sanitize_sql_array([
      "UPDATE geofences SET geom = ST_SetSRID(ST_GeomFromGeoJSON(?),4326) WHERE id = ?", geometry, id
    ]))
  end
end
