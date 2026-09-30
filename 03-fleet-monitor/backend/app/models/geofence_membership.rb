class GeofenceMembership < ApplicationRecord
  belongs_to :vehicle
  belongs_to :geofence
end
