require 'test_helper'
class ScenarioDomainTest < ActiveSupport::TestCase
 setup do
  @user=User.create!(email:'planner@test.local',name:'Planner',password:'Learning123!',role:'staff')
  @parcel=Parcel.create!(name:'Test block',district:'Test',height_limit:4,boundary:{type:'Polygon',coordinates:[[[-96.8,32.7],[-96.799,32.7],[-96.799,32.701],[-96.8,32.701],[-96.8,32.7]]]})
 end
 def scenario(**extra)
  Scenario.create!({user:@user,name:'Test',parcel_ids:[@parcel.id],floors:5,coverage:0.5,unit_area:800}.merge(extra))
 end
 test 'area calculations retain explicit assumptions and warn about height' do
  result=ScenarioCalculator.call(scenario)
  assert result[:site_acres]>0
  assert_equal 2.5,result[:floor_area_ratio]
  assert_equal (result[:residential_area_sqft]/800.0).floor,result[:units]
  assert_equal 1,result[:warnings].length
 end
 test 'invalid parameters and unknown selections are rejected' do
  assert_raises(ActiveRecord::RecordInvalid){scenario(coverage:1.2)}
  assert_raises(ActiveRecord::RecordInvalid){scenario(parcel_ids:[@parcel.id,@parcel.id])}
  assert_raises(ActiveRecord::RecordInvalid){scenario(floors:-1)}
 end
 test 'duplicate and stale calculation jobs cannot overwrite newer results' do
  s=scenario;CalculateScenarioJob.perform_now(s.id,1);assert_equal 'complete',s.reload.status
  before=s.results;CalculateScenarioJob.perform_now(s.id,1);assert_equal before,s.reload.results
  s.update!(revision:2,status:'queued');CalculateScenarioJob.perform_now(s.id,1);assert_equal 'queued',s.reload.status
 end
end
class ScenarioApiTest < ActionDispatch::IntegrationTest
 test 'queue outage persists a failed scenario that the user can retry' do
  user=User.create!(email:'queue@test.local',name:'Queue tester',password:'Learning123!',role:'staff')
  parcel=Parcel.create!(name:'Queue block',district:'Test',boundary:{type:'Polygon',coordinates:[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]})
  post '/api/session',params:{email:user.email,password:'Learning123!'},as: :json
  adapter=Object.new
  def adapter.enqueue(job) = raise('Queue offline')
  def adapter.enqueue_at(job, timestamp) = enqueue(job)
  previous=CalculateScenarioJob.queue_adapter
  begin
   CalculateScenarioJob.queue_adapter=adapter
   post '/api/scenarios',params:{scenario:{name:'Retry this',parcel_ids:[parcel.id],floors:2,coverage:0.5,unit_area:900}},as: :json
   assert_response :created
   assert_equal 'failed',response.parsed_body['status']
   assert_includes response.parsed_body['error_message'],'Retry'
  ensure
   CalculateScenarioJob.queue_adapter=previous
  end
 end
 test 'unauthenticated access denied and user isolation enforced' do
  get '/api/scenarios';assert_response :unauthorized
  a=User.create!(email:'a@test.local',name:'A',password:'Learning123!',role:'staff')
  b=User.create!(email:'b@test.local',name:'B',password:'Learning123!',role:'reporter')
  p=Parcel.create!(name:'API block',district:'Test',boundary:{type:'Polygon',coordinates:[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]})
  s=Scenario.create!(user:a,name:'Private',parcel_ids:[p.id],floors:2,coverage:0.5,unit_area:900)
  post '/api/session',params:{email:b.email,password:'Learning123!'},as: :json
  get "/api/scenarios/#{s.id}";assert_response :not_found
  get '/api/parcels',params:{bbox:'bad'};assert_response :unprocessable_entity
 end
 test 'the scenario list returns the latest 100 without parcel snapshots' do
  user=User.create!(email:'list@test.local',name:'Lister',password:'Learning123!',role:'staff')
  parcel=Parcel.create!(name:'List block',district:'Test',boundary:{type:'Polygon',coordinates:[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]})
  scenarios=(Scenario::LIST_LIMIT+1).times.map { |i| Scenario.create!(user:user,name:"Scenario #{i}",parcel_ids:[parcel.id],floors:2,coverage:0.5,unit_area:900,created_at:i.minutes.ago) }
  scenarios.first.update_columns(status:'complete',results:{'units'=>12,'parcel_snapshot'=>[{'id'=>parcel.id,'boundary'=>parcel.boundary}]})
  post '/api/session',params:{email:user.email,password:'Learning123!'},as: :json
  get '/api/scenarios'
  assert_response :success
  assert_equal scenarios.first(Scenario::LIST_LIMIT).map(&:id),response.parsed_body.map { |s| s['id'] }
  assert_equal({'units'=>12},response.parsed_body.first['results'])
  get "/api/scenarios/#{scenarios.first.id}"
  assert_equal parcel.id,response.parsed_body.dig('results','parcel_snapshot',0,'id')
  get "/api/scenarios/#{scenarios.first.id}/export"
  assert_equal parcel.id,JSON.parse(response.body).dig('results','parcel_snapshot',0,'id')
 end
 test 'a failed calculation is retried from the app, not by Sidekiq' do
  assert_equal false,CalculateScenarioJob.get_sidekiq_options['retry']
 end
end
