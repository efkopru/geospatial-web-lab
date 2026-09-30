staff = User.find_or_create_by!(email: "staff@example.test") do |user|
  user.name = "Taylor Morgan"
  user.role = "staff"
  user.password = "Learning123!"
end
reporter = User.find_or_create_by!(email: "reporter@example.test") do |user|
  user.name = "Jordan Lee"
  user.role = "reporter"
  user.password = "Learning123!"
end

%w[parks-clean.geojson parks-with-errors.geojson].each do |filename|
  dataset, created = Dataset.import!(user: reporter, name: filename.delete_suffix(".geojson").tr("-", " ").titleize,
                                     source_text: Rails.root.join("samples", filename).read)
  ValidateDatasetJob.perform_now(dataset.id) if created || %w[queued failed].include?(dataset.status)
end
clean = Dataset.find_by!(name: "Parks Clean", user: reporter)
clean.approve!(approver: staff) if clean.status == "ready"
