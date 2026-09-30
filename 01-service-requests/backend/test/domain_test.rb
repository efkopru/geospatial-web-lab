require 'test_helper'
require 'csv'
require 'digest'
require 'action_cable/channel/test_case'

class ServiceRequestDomainTest < ActiveSupport::TestCase
  setup do
    @staff = User.create!(email: 'domain-staff@example.test', name: 'Domain Staff', role: 'staff', password: 'Learning123!')
    @reporter = User.create!(email: 'domain-reporter@example.test', name: 'Domain Reporter', role: 'reporter', password: 'Learning123!')
  end

  def build_issue(**attributes)
    Issue.new({ title: 'Test pothole', category: 'roads', reporter: @reporter, latitude: 33.045, longitude: -96.995 }.merge(attributes))
  end

  test 'coordinates, staff assignment, and legal lifecycle transitions are enforced' do
    issue = build_issue(latitude: 91)
    assert_not issue.valid?
    issue.latitude = 33.045
    issue.save!
    assert_not issue.update(status: 'resolved', assigned_to: @staff)
    issue.reload
    assert_not issue.update(status: 'assigned', assigned_to: @reporter)
    issue.reload.update!(status: 'assigned', assigned_to: @staff)
    issue.update!(status: 'in_progress')
    issue.update!(status: 'resolved')
    assert issue.resolved_at
    issue.update!(status: 'in_progress')
    assert_nil issue.resolved_at
  end

  test 'spatial radius uses geographic meters and coordinates update generated location' do
    nearby = build_issue.tap(&:save!)
    distant = build_issue(title: 'Distant', latitude: 34, longitude: -97).tap(&:save!)
    assert_includes Issue.near(33.045, -96.995, 500), nearby
    assert_not_includes Issue.near(33.045, -96.995, 500), distant
    nearby.update!(latitude: 35)
    assert_not_includes Issue.near(33.045, -96.995, 500), nearby
  end

  test 'import job reports invalid rows and repeated execution does not duplicate records' do
    payload = { 'type' => 'FeatureCollection', 'features' => [
      { 'type' => 'Feature', 'geometry' => { 'type' => 'Point', 'coordinates' => [-96.995, 33.045] }, 'properties' => { 'title' => 'Imported issue', 'category' => 'roads' } },
      { 'type' => 'Feature', 'geometry' => { 'type' => 'Point', 'coordinates' => [-96.995, 95] }, 'properties' => { 'title' => 'Invalid latitude', 'category' => 'roads' } },
      { 'type' => 'Feature', 'geometry' => 'invalid', 'properties' => {} }
    ] }
    run = ImportRun.create!(requested_by: @staff, digest: Digest::SHA256.hexdigest(payload.to_json), payload: payload)
    assert_difference 'Issue.count', 1 do
      ImportIssuesJob.perform_now(run.id)
      ImportIssuesJob.perform_now(run.id)
    end
    assert_equal 'completed', run.reload.status
    assert_equal 3, run.processed_count
    assert_equal 1, run.imported_count
    assert_equal [2, 3], run.row_errors.map { |row| row['row'] }
    run.update!(status: 'failed')
    assert_no_difference 'Issue.count' do
      ImportIssuesJob.perform_now(run.id)
    end
    assert_equal 1, run.reload.imported_count
  end

  test 'background report includes records and neutralizes formula text' do
    build_issue(title: '=HYPERLINK("https://example.test")').save!
    run = ExportRun.create!(requested_by: @staff)
    ExportIssuesJob.perform_now(run.id)
    assert_equal 'completed', run.reload.status
    assert_equal 1, run.record_count
    rows = CSV.parse(run.content, headers: true)
    assert_equal "'=HYPERLINK(\"https://example.test\")", rows.first['title']
  end
end

class ServiceRequestApiTest < ActionDispatch::IntegrationTest
  setup do
    @staff = User.create!(email: 'api-staff@example.test', name: 'API Staff', role: 'staff', password: 'Learning123!')
    @reporter = User.create!(email: 'api-reporter@example.test', name: 'API Reporter', role: 'reporter', password: 'Learning123!')
    @other = User.create!(email: 'api-other@example.test', name: 'Other Reporter', role: 'reporter', password: 'Learning123!')
    @issue = Issue.create!(title: 'Own issue', category: 'roads', reporter: @reporter, latitude: 33.045, longitude: -96.995)
    @hidden = Issue.create!(title: 'Other issue', category: 'parks', reporter: @other, latitude: 33.046, longitude: -96.996)
  end

  def login(user)
    post '/api/session', params: { email: user.email, password: 'Learning123!' }, as: :json
    assert_response :success
  end

  test 'anonymous requests are rejected and reporters only read their own issues' do
    get '/api/issues'
    assert_response :unauthorized
    login(@reporter)
    get '/api/issues'
    assert_response :success
    assert_equal [@issue.id], response.parsed_body['issues'].map { |row| row['id'] }
    get "/api/issues/#{@hidden.id}"
    assert_response :not_found
    patch "/api/issues/#{@issue.id}", params: { issue: { status: 'assigned', assigned_to_id: @staff.id, lock_version: 0 } }, as: :json
    assert_response :forbidden
    post '/api/import_runs', params: { geojson: {} }, as: :json
    assert_response :forbidden
    post '/api/export_runs', as: :json
    assert_response :forbidden
  end

  test 'reporter creation ignores forged ownership and status' do
    login(@reporter)
    post '/api/issues', params: { issue: { title: 'New report', category: 'lighting', latitude: 33.05, longitude: -96.99, reporter_id: @other.id, status: 'resolved' } }, as: :json
    assert_response :created
    created = Issue.find(response.parsed_body['issue']['id'])
    assert_equal @reporter, created.reporter
    assert_equal 'new', created.status
    post '/api/issues', params: { issue: { title: 'Bad coordinates', category: 'roads', latitude: -95, longitude: 0 } }, as: :json
    assert_response :unprocessable_entity
  end

  test 'staff update rejects stale versions and invalid status jumps' do
    login(@staff)
    patch "/api/issues/#{@issue.id}", params: { issue: { assigned_to_id: @staff.id, lock_version: 0 } }, as: :json
    assert_response :success
    assert_equal 'assigned', @issue.reload.status
    patch "/api/issues/#{@issue.id}", params: { issue: { status: 'in_progress', lock_version: 0 } }, as: :json
    assert_response :conflict
    patch "/api/issues/#{@issue.id}", params: { issue: { status: 'resolved', lock_version: @issue.lock_version } }, as: :json
    assert_response :unprocessable_entity
    assert_equal 'assigned', @issue.reload.status
  end

  test 'staff filters reject invalid distances and match nearby issues' do
    login(@staff)
    get '/api/issues', params: { latitude: 33.045, longitude: -96.995, radius_m: 5 }
    assert_response :success
    assert_equal [@issue.id], response.parsed_body['issues'].map { |row| row['id'] }
    get '/api/issues', params: { latitude: 33.045, longitude: -96.995, radius_m: '-1' }
    assert_response :unprocessable_entity
    get '/api/issues', params: { latitude: 'NaN', longitude: -96.995, radius_m: 100 }
    assert_response :unprocessable_entity
  end

  test 'duplicate import submissions reuse a job and reports are owner scoped' do
    login(@staff)
    payload = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-96.995, 33.045] }, properties: { title: 'Imported', category: 'roads' } }] }
    assert_difference 'ImportRun.count', 1 do
      2.times { post '/api/import_runs', params: { geojson: payload }, as: :json; assert_response :success }
    end
    assert response.parsed_body['reused']
    post '/api/export_runs', as: :json
    assert_response :accepted
    run_id = response.parsed_body['export']['id']
    get "/api/export_runs/#{run_id}/download"
    assert_response :conflict
    ExportIssuesJob.perform_now(run_id)
    get "/api/export_runs/#{run_id}/download"
    assert_response :success
    assert_includes response.media_type, 'text/csv'
    second_staff = User.create!(email: 'second@example.test', name: 'Second', role: 'staff', password: 'Learning123!')
    login(second_staff)
    get "/api/export_runs/#{run_id}/download"
    assert_response :not_found
  end
end

class RequestUpdatesChannelTest < ActionCable::Channel::TestCase
  tests RequestUpdatesChannel

  test 'reporters subscribe only to their personal request stream' do
    user = User.create!(email: 'channel@example.test', name: 'Channel Reporter', role: 'reporter', password: 'Learning123!')
    stub_connection current_user: user
    subscribe
    assert subscription.confirmed?
    assert_has_stream "service_requests:user:#{user.id}"
    assert_equal ["service_requests:user:#{user.id}"], subscription.streams
  end
end
