require 'test_helper'

class ScenarioIdentifierValidationTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(email: 'second-scenario-audit@example.test', name: 'Planner', role: 'staff', password: 'Learning123!')
    @parcel = Parcel.create!(name: 'Identifier parcel', district: 'Test', boundary: {type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]})
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
  end

  test 'fractional parcel identifiers cannot silently select another parcel' do
    assert_no_difference 'Scenario.count' do
      post '/api/scenarios', params: {scenario: {name: 'Invalid identifier', parcel_ids: [@parcel.id + 0.5], floors: 2, coverage: 0.5, unit_area: 900}}, as: :json
      assert_response :unprocessable_entity
    end
  end

  test 'non-string bounding boxes return validation errors instead of server failures' do
    [[0, 0, 1, 1], {west: 0}, 42].each do |value|
      get '/api/parcels', params: {bbox: value}, as: :json
      assert_response :unprocessable_entity
      assert_match(/bbox requires/, response.parsed_body['error'])
    end
  end
end
