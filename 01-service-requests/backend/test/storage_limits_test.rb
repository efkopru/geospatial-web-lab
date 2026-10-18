require 'test_helper'

class ServiceRequestStorageLimitsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @staff = User.create!(email: 'storage-limits@example.test', name: 'Limits Staff', role: 'staff', password: 'Learning123!')
    post '/api/session', params: {email: @staff.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  def collection(title)
    {type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [-97, 33]}, properties: {title: title, category: 'roads'}}]}
  end

  test 'an account may hold 100 imports, and a file imported before still reopens its run' do
    post '/api/import_runs', params: {geojson: collection('First')}, as: :json
    assert_response :accepted
    first = response.parsed_body.dig('import', 'id')
    now = Time.current
    ImportRun.insert_all((ImportRun::MAX_PER_USER - 1).times.map { |index|
      {requested_by_id: @staff.id, digest: "filler-#{index}", payload: {features: []}, status: 'completed', created_at: now, updated_at: now}
    })
    assert_no_difference 'ImportRun.count' do
      post '/api/import_runs', params: {geojson: collection('One too many')}, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal 'You have 100 imports, the limit for one account. Uploading a file you imported before still reopens its import.', response.parsed_body['error']
    post '/api/import_runs', params: {geojson: collection('First')}, as: :json
    assert_response :success
    assert_equal [true, first], [response.parsed_body['reused'], response.parsed_body.dig('import', 'id')]
  end

  test 'only the newest 30 reports are kept, and unfinished or other accounts\' reports are never removed' do
    unfinished = ExportRun.create!(requested_by: @staff, status: 'processing')
    now = Time.current
    ExportRun.insert_all(ExportRun::KEEP_PER_USER.times.map {
      {requested_by_id: @staff.id, status: 'completed', content: 'id,title', record_count: 1, created_at: now, updated_at: now}
    })
    oldest_finished = ExportRun.where(requested_by: @staff, status: 'completed').minimum(:id)
    other = User.create!(email: 'other-storage-limits@example.test', name: 'Other Staff', role: 'staff', password: 'Learning123!')
    others = ExportRun.create!(requested_by: other, status: 'completed', content: 'id,title')

    post '/api/export_runs', as: :json
    assert_response :accepted
    newest = response.parsed_body.dig('export', 'id')
    mine = ExportRun.where(requested_by: @staff)
    assert_equal ExportRun::KEEP_PER_USER + 1, mine.count, 'The newest 30 plus the unfinished report'
    assert_not ExportRun.exists?(oldest_finished)
    assert ExportRun.exists?(unfinished.id)
    assert ExportRun.exists?(newest)
    assert ExportRun.exists?(others.id)
  end
end
