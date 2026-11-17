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

  # Open and critical observation counts by asset id, for every asset or the given ones, in one
  # query. Listing assets therefore never loads the observations themselves.
  def self.open_inspection_counts(asset_ids = nil)
    scope = Inspection.where(status: "open")
    scope = scope.where(infrastructure_asset_id: asset_ids) if asset_ids
    scope.group(:infrastructure_asset_id)
      .pluck(:infrastructure_asset_id, Arel.sql("COUNT(*)"), Arel.sql("COUNT(*) FILTER (WHERE severity = 'critical')"))
      .to_h { |id, open, critical| [id, { open: open, critical: critical }] }
  end

  # Every asset's payload in corridor order, from two queries.
  def self.payloads
    counts = open_inspection_counts
    order(:corridor_order, :id).map { |asset| asset.payload(counts[asset.id]) }
  end

  def payload(counts = self.class.open_inspection_counts(id)[id])
    counts ||= { open: 0, critical: 0 }
    as_json(only: %i[id asset_code name kind longitude latitude ground_elevation_m structure_height_m corridor_order]).merge(
      "top_elevation_m" => ground_elevation_m + structure_height_m,
      "open_inspections" => counts[:open],
      "critical_inspections" => counts[:critical]
    )
  end

  private

  def write_geometry
    self.class.connection.execute(self.class.sanitize_sql_array([
      "UPDATE infrastructure_assets SET geom=ST_SetSRID(ST_MakePoint(?,?,?),4326) WHERE id=?", longitude, latitude, ground_elevation_m, id
    ]))
  end
end
