staff = User.find_or_create_by!(email: 'staff@example.test') do |u|
  u.name = 'Alex Morgan'; u.password = 'Learning123!'; u.role = 'staff'
end
reporter = User.find_or_create_by!(email: 'reporter@example.test') do |u|
  u.name = 'Jordan Lee'; u.password = 'Learning123!'; u.role = 'reporter'
end
User.find_or_create_by!(email: 'crew@example.test') do |u|
  u.name = 'Casey Rivera'; u.password = 'Learning123!'; u.role = 'staff'
end
[
  ['Pavement repair on Oak Street', 'roads', 33.0471, -96.9942, 'new'],
  ['Streetlight near the library', 'lighting', 33.0437, -96.9918, 'assigned'],
  ['Blocked drainage grate', 'drainage', 33.0417, -96.9982, 'in_progress'],
  ['Damaged park bench', 'parks', 33.0508, -96.9975, 'resolved'],
  ['Faded crossing near school', 'roads', 33.0465, -97.0013, 'new'],
  ['Trail light requires repair', 'lighting', 33.0520, -96.9911, 'in_progress']
].each_with_index do |(title, category, latitude, longitude, status), index|
  Issue.find_or_create_by!(source_key: "seed:#{index}") do |issue|
    issue.assign_attributes(title: title, category: category, latitude: latitude, longitude: longitude,
      description: 'Synthetic training record. This is not a real municipal service request.',
      reporter: reporter, status: status, assigned_to: status == 'new' ? nil : staff,
      created_at: (index + 1).days.ago)
  end
end
