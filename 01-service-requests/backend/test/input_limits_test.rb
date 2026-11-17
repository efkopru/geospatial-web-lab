require 'test_helper'

# Unusual input answers 422 with a plain message instead of a server error, and one account may
# create a limited number of requests in ten minutes.
class ServiceRequestInputLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @staff = User.create!(email: 'limits-staff@example.test', name: 'Limits staff', password: 'Learning123!', role: 'staff')
    @reporter = User.create!(email: 'limits-reporter@example.test', name: 'Limits reporter', password: 'Learning123!', role: 'reporter')
  end

  def login(user)
    post '/api/session', params: {email: user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  def issue(**attributes)
    {issue: {title: 'Streetlight out', category: 'lighting', latitude: 33.045, longitude: -96.995}.merge(attributes)}
  end

  test 'text with a NUL character is refused in requests and imports, and nothing is stored' do
    login(@staff)
    {
      issue(title: "Bad\u0000title") => 'The parameter issue.title',
      issue(description: "Bad\u0000description") => 'The parameter issue.description'
    }.each do |body, location|
      assert_no_difference('Issue.count') { post '/api/issues', params: body, as: :json }
      assert_response :unprocessable_entity
      assert_equal "#{location} contains the NUL character (\\u0000), which cannot be stored. Remove it and try again.", response.parsed_body['error']
    end
    feature = {type: 'Feature', geometry: {type: 'Point', coordinates: [-96.995, 33.045]}, properties: {title: "Bad\u0000import"}}
    assert_no_difference('ImportRun.count') { post '/api/import_runs', params: {geojson: {type: 'FeatureCollection', features: [feature]}}, as: :json }
    assert_response :unprocessable_entity
    assert_match 'The parameter geojson.features[0].properties.title contains the NUL character', response.parsed_body['error']
  end

  test 'list filters must be text, and only a bad distance filter reports a distance error' do
    login(@staff)
    ['/api/issues?status[a]=b', '/api/issues?category[]=roads&category[]=parks', '/api/issues?q[]=light'].each do |path|
      get path
      assert_response :unprocessable_entity
      assert_equal 'The status, category and search filters must be text.', response.parsed_body['error']
    end
    get '/api/issues?q=a%00b'
    assert_response :unprocessable_entity
    assert_match 'The parameter q contains the NUL character', response.parsed_body['error']
    get '/api/issues', params: {latitude: 'north', longitude: -96.995, radius_m: 100}
    assert_response :unprocessable_entity
    assert_equal 'Distance filter must contain numeric latitude, longitude, and radius.', response.parsed_body['error']
    get '/api/issues', params: {status: 'new', category: 'roads', q: 'light'}
    assert_response :success
  end

  test 'one account may create a limited number of requests in ten minutes' do
    limit = Api::IssuesController::CREATES_PER_TEN_MINUTES
    login(@reporter)
    limit.times do |number|
      post '/api/issues', params: issue(title: "Request #{number}"), as: :json
      assert_response :created
    end
    assert_no_difference('Issue.count') { post '/api/issues', params: issue, as: :json }
    assert_response :too_many_requests
    assert_equal 'You are creating requests too quickly. Wait a few minutes and try again.', response.parsed_body['error']
    get '/api/issues'
    assert_response :success
    login(@staff)
    post '/api/issues', params: issue, as: :json
    assert_response :created, 'Another account is not limited'
    travel 11.minutes
    login(@reporter)
    post '/api/issues', params: issue, as: :json
    assert_response :created
  end
end
