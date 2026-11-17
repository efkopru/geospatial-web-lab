require 'test_helper'

# Unusual input answers 422 with a plain message instead of a server error.
class ScenarioInputLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(email: 'limits@example.test', name: 'Limits planner', password: 'Learning123!', role: 'staff')
    @parcel = Parcel.create!(name: 'Limits block', district: 'North', boundary: {type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]})
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'a scenario name with a NUL character is refused and nothing is stored' do
    scenario = {name: "Bad\u0000name", parcel_ids: [@parcel.id], floors: 2, coverage: 0.5, unit_area: 900}
    assert_no_difference('Scenario.count') { post '/api/scenarios', params: {scenario: scenario}, as: :json }
    assert_response :unprocessable_entity
    assert_equal "The parameter scenario.name contains the NUL character (\\u0000), which cannot be stored. Remove it and try again.", response.parsed_body['error']
  end

  test 'the district filter must be text' do
    get '/api/parcels?district[a]=b'
    assert_response :unprocessable_entity
    assert_equal 'district must be text', response.parsed_body['error']
    get '/api/parcels?district=a%00b'
    assert_response :unprocessable_entity
    assert_match 'The parameter district contains the NUL character', response.parsed_body['error']
    get '/api/parcels', params: {district: 'North'}
    assert_response :success
    assert_equal [@parcel.id], response.parsed_body['features'].map { |feature| feature['id'] }
  end
end
