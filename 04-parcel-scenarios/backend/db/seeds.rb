staff=User.find_or_create_by!(email: 'staff@example.test') { |u| u.name='Alex Morgan';u.password='Learning123!';u.role='staff' }
User.find_or_create_by!(email: 'reporter@example.test') { |u| u.name='Jordan Lee';u.password='Learning123!';u.role='reporter' }
24.times do |i|
 x=-96.817+(i%6)*0.003; y=32.774+(i/6)*0.0025
 Parcel.find_or_create_by!(name: "Parcel #{(i+1).to_s.rjust(3,'0')}") do |p|
  p.district = i<12 ? 'River district' : 'North quarter';p.height_limit=i%3==0 ? 6 : 12
  p.boundary={type:'Polygon',coordinates:[[[x,y],[x+0.002,y],[x+0.002,y+0.0015],[x,y+0.0015],[x,y]]]}
 end
end
unless Scenario.exists?(user_id: staff.id)
 [{name:'Courtyard homes',floors:3,coverage:0.35,unit_area:900},{name:'Mixed-use blocks',floors:7,coverage:0.55,unit_area:850}].each do |attrs|
  s=Scenario.create!(**attrs,user:staff,parcel_ids:Parcel.limit(4).pluck(:id));CalculateScenarioJob.perform_now(s.id,s.revision)
 end
end
