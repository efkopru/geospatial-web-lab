class InfrastructureAsset < ApplicationRecord
  has_many :inspections, dependent: :destroy
  validates :asset_code, presence: true, uniqueness: true
  validates :name, presence: true
  validates :kind, inclusion: { in: %w[pole tower cabinet] }
  validates :longitude, numericality: { in: -180..180 }
  validates :latitude, numericality: { in: -90..90 }
  validates :ground_elevation_m, numericality: { in: -500..9000 }
  validates :structure_height_m, numericality: { greater_than: 0, less_than_or_equal_to: 300 }
  validates :corridor_order, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  after_save :write_geometry

  def payload
    as_json(only: %i[id asset_code name kind longitude latitude ground_elevation_m structure_height_m corridor_order]).merge(
      "top_elevation_m" => ground_elevation_m + structure_height_m,
      "open_inspections" => inspections.count { |inspection| inspection.status == "open" },
      "critical_inspections" => inspections.count { |inspection| inspection.status == "open" && inspection.severity == "critical" }
    )
  end

  private

  def write_geometry
    self.class.connection.execute(self.class.sanitize_sql_array([
      "UPDATE infrastructure_assets SET geom=ST_SetSRID(ST_MakePoint(?,?,?),4326) WHERE id=?", longitude, latitude, ground_elevation_m, id
    ]))
  end
end
