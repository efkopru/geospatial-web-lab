class ScenarioCalculator
 SQFT_PER_M2 = 10.76391041671
 def self.call(scenario)
  parcels = Parcel.where(id: scenario.parcel_ids).select('parcels.*, ST_Area(geom::geography) AS area_m2')
  raise ArgumentError, 'A selected parcel no longer exists' unless parcels.length == scenario.parcel_ids.length
  site_sqft = parcels.sum { |p| p.area_m2.to_f * SQFT_PER_M2 }
  gross = site_sqft * scenario.coverage.to_f * scenario.floors
  residential = gross * 0.8
  warnings = parcels.select { |p| scenario.floors > p.height_limit }.map { |p| "#{p.name}: #{scenario.floors} floors exceeds the synthetic #{p.height_limit}-floor limit" }
  {formula_version: 1, site_acres: (site_sqft/43560).round(2), gross_floor_area_sqft: gross.round, residential_area_sqft: residential.round,
   units: (residential/scenario.unit_area).floor, open_space_sqft: (site_sqft*(1-scenario.coverage.to_f)).round,
   floor_area_ratio: (scenario.coverage.to_f*scenario.floors).round(2), warnings: warnings,
   assumptions: {residential_efficiency: 0.8, unit_area_sqft: scenario.unit_area, floors: scenario.floors, coverage: scenario.coverage.to_f},
   parcel_snapshot: parcels.map { |p| {id: p.id, name: p.name, area_m2: p.area_m2.to_f.round(3), boundary: p.boundary} }}
 end
end
