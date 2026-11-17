require 'test_helper'

# Unusual input answers 422 instead of a server error, one account may record a limited number
# of observations in ten minutes, and listing assets counts observations without loading them.
class InspectionInputLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @staff = User.create!(name: 'Limits inspector', email: 'limits-staff@example.test', role: 'staff', password: 'Learning123!')
    @reporter = User.create!(name: 'Limits reporter', email: 'limits-reporter@example.test', role: 'reporter', password: 'Learning123!')
    @asset = InfrastructureAsset.create!(asset_code: 'LIMIT-A', name: 'Limits tower', kind: 'tower', longitude: -105.28, latitude: 39.98, ground_elevation_m: 1600, structure_height_m: 30, corridor_order: 0)
    @second = InfrastructureAsset.create!(asset_code: 'LIMIT-B', name: 'Limits pole', kind: 'pole', longitude: -105.27, latitude: 39.98, ground_elevation_m: 1620, structure_height_m: 20, corridor_order: 1)
  end

  def login(user)
    post '/api/session', params: {email: user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  def observation(**attributes)
    {inspection: {severity: 'low', notes: 'A synthetic observation for the limits test.', observed_at: Time.current.iso8601}.merge(attributes)}
  end

  test 'observation notes with a NUL character are refused and nothing is stored' do
    login(@reporter)
    assert_no_difference(['Inspection.count', 'InspectionEvent.count']) do
      post "/api/assets/#{@asset.id}/inspections", params: observation(notes: "Bad\u0000 observation notes"), as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "The parameter inspection.notes contains the NUL character (\\u0000), which cannot be stored. Remove it and try again.", response.parsed_body['error']
  end

  test 'one account may record a limited number of observations in ten minutes' do
    limit = Api::InspectionsController::CREATES_PER_TEN_MINUTES
    login(@reporter)
    limit.times do
      post "/api/assets/#{@asset.id}/inspections", params: observation, as: :json
      assert_response :created
    end
    assert_no_difference('Inspection.count') { post "/api/assets/#{@asset.id}/inspections", params: observation, as: :json }
    assert_response :too_many_requests
    assert_equal 'You are recording observations too quickly. Wait a few minutes and try again.', response.parsed_body['error']
    login(@staff)
    post "/api/assets/#{@asset.id}/inspections", params: observation, as: :json
    assert_response :created, 'Another account is not limited'
    patch "/api/inspections/#{Inspection.last.id}", params: {inspection: {status: 'resolved', resolution_notes: 'Resolved during the limits test.', lock_version: 0}}, as: :json
    assert_response :success, 'Resolving is not limited'
    travel 11.minutes
    login(@reporter)
    post "/api/assets/#{@asset.id}/inspections", params: observation, as: :json
    assert_response :created
  end

  test 'asset lists count open and critical observations without loading them' do
    @asset.inspections.create!(author: @reporter, severity: 'low', notes: 'An open low observation.', observed_at: Time.current)
    @asset.inspections.create!(author: @reporter, severity: 'critical', notes: 'An open critical observation.', observed_at: Time.current)
    @asset.inspections.create!(author: @reporter, severity: 'critical', notes: 'A resolved critical observation.', observed_at: Time.current,
      status: 'resolved', resolution_notes: 'Resolved before the test.', resolved_by: @staff, resolved_at: Time.current)
    login(@reporter)
    assert_no_queries_match(/SELECT "inspections"\.\*/) { get '/api/assets' }
    assert_response :success
    listed = response.parsed_body['assets'].select { |asset| %w[LIMIT-A LIMIT-B].include?(asset['asset_code']) }
    assert_equal [['LIMIT-A', 2, 1], ['LIMIT-B', 0, 0]], listed.map { |asset| asset.values_at('asset_code', 'open_inspections', 'critical_inspections') }
    get "/api/assets/#{@asset.id}"
    assert_response :success
    assert_equal [2, 1, 3], [response.parsed_body.dig('asset', 'open_inspections'), response.parsed_body.dig('asset', 'critical_inspections'), response.parsed_body['inspections'].size]
    assert_no_queries_match(/SELECT "inspections"\.\*/) { post '/api/profile_runs', params: {}, as: :json }
    assert_response :accepted
    snapshot = ProfileRun.last.asset_snapshot.select { |asset| %w[LIMIT-A LIMIT-B].include?(asset['asset_code']) }
    assert_equal [2, 0], snapshot.map { |asset| asset['open_inspections'] }
  end
end
