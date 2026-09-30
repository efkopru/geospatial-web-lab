staff = User.find_or_create_by!(email: "staff@example.test") { |u| u.name = "Asset supervisor"; u.role = "staff"; u.password = "Learning123!" }
reporter = User.find_or_create_by!(email: "reporter@example.test") { |u| u.name = "Field inspector"; u.role = "reporter"; u.password = "Learning123!" }
data = [
  ["P-101", "West approach pole", "pole", -105.2810, 39.9830, 1665, 16],
  ["P-102", "Creek crossing pole", "pole", -105.2780, 39.9841, 1658, 18],
  ["T-201", "Ridge transmission tower", "tower", -105.2748, 39.9850, 1678, 42],
  ["C-301", "Ridge control cabinet", "cabinet", -105.2732, 39.9854, 1681, 2.4],
  ["P-103", "East slope pole", "pole", -105.2711, 39.9865, 1689, 20],
  ["T-202", "Summit relay tower", "tower", -105.2681, 39.9876, 1702, 48],
  ["P-104", "Service road pole", "pole", -105.2650, 39.9871, 1694, 16],
  ["C-302", "East control cabinet", "cabinet", -105.2624, 39.9882, 1690, 2.2]
]
data.each_with_index do |(code, name, kind, longitude, latitude, ground, height), index|
  InfrastructureAsset.find_or_create_by!(asset_code: code) do |asset|
    asset.name = name; asset.kind = kind; asset.longitude = longitude; asset.latitude = latitude
    asset.ground_elevation_m = ground; asset.structure_height_m = height; asset.corridor_order = index
  end
end
if Inspection.count.zero?
  InfrastructureAsset.find_by!(asset_code: "T-201").inspections.create!(author: reporter, severity: "high", notes: "Synthetic observation: corrosion visible at the lower tower cross-brace. Schedule a close inspection.", observed_at: 2.days.ago)
  InfrastructureAsset.find_by!(asset_code: "P-103").inspections.create!(author: staff, severity: "medium", notes: "Synthetic observation: vegetation is approaching the pole access route. Confirm clearance at the next visit.", observed_at: 1.day.ago)
end
