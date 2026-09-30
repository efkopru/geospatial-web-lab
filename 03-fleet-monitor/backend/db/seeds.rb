User.find_or_create_by!(email: "staff@example.test") { |u| u.name = "Fleet operator"; u.role = "staff"; u.password = "Learning123!" }
User.find_or_create_by!(email: "reporter@example.test") { |u| u.name = "Fleet observer"; u.role = "reporter"; u.password = "Learning123!" }
ReplayControl.instance

corners = [[-96.818, 32.765], [-96.784, 32.765], [-96.784, 32.792], [-96.818, 32.792], [-96.818, 32.765]]
route = corners.each_cons(2).flat_map do |a, b|
  20.times.map { |i| [a[0] + (b[0] - a[0]) * i / 20.0, a[1] + (b[1] - a[1]) * i / 20.0] }
end
colors = %w[#06b6d4 #f97316 #8b5cf6 #22c55e #eab308 #ec4899 #3b82f6 #14b8a6 #ef4444 #a855f7]
10.times do |index|
  Vehicle.find_or_create_by!(registration: "SIM-#{(index + 1).to_s.rjust(3, '0')}") do |v|
    v.name = "Unit #{(index + 1).to_s.rjust(2, '0')}"
    v.color = colors[index]
    v.route = route.map { |lng, lat| [lng + (index % 3 - 1) * 0.001, lat + (index % 2) * 0.001] }
    v.route_offset = index * 8
  end
end
[
  ["North depot", "#8b5cf6", [[-96.808, 32.788], [-96.779, 32.788], [-96.779, 32.798], [-96.808, 32.798], [-96.808, 32.788]]],
  ["South service area", "#f59e0b", [[-96.824, 32.758], [-96.801, 32.758], [-96.801, 32.770], [-96.824, 32.770], [-96.824, 32.758]]]
].each do |name, color, coordinates|
  Geofence.find_or_create_by!(name: name) { |f| f.color = color; f.coordinates = coordinates }
end
