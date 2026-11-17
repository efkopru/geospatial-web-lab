require 'test_helper'

# Unusual input answers 422 with a plain message instead of being stored in a changed form.
class DatasetInputLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @reporter = User.create!(email: 'limits-reporter@example.test', name: 'Limits reporter', password: 'Learning123!', role: 'reporter')
    @source = JSON.generate(type: 'FeatureCollection', features: [
      {type: 'Feature', properties: {asset_id: 'limit-1'}, geometry: {type: 'Point', coordinates: [-97, 33]}}
    ])
    post '/api/session', params: {email: @reporter.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'a dataset name must be text' do
    [{a: 1}, ['Parks'], 42].each do |name|
      assert_no_difference('Dataset.count') { post '/api/datasets', params: {name: name, source: @source}, as: :json }
      assert_response :unprocessable_entity
      assert_equal 'Dataset name must be text', response.parsed_body['error']
    end
    assert_difference('Dataset.count', 1) { post '/api/datasets', params: {name: 'Parks', source: @source}, as: :json }
    assert_response :created
  end
end
