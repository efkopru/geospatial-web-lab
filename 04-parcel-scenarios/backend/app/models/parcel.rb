class Parcel < ApplicationRecord
 validates :name, :district, :boundary, presence: true
 def self.features
  select('parcels.*, ST_Area(geom::geography) AS area_m2').map do |p|
   {type: 'Feature', id: p.id, geometry: p.boundary, properties: {id: p.id, title: p.name, district: p.district, area_acres: (p.area_m2.to_f / 4046.8564224).round(2), height_limit: p.height_limit}}
  end
 end
end
