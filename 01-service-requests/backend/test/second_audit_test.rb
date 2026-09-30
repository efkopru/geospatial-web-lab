require 'test_helper'

class ServiceRequestSecondAuditTest < ActionDispatch::IntegrationTest
  setup do
    @staff = User.create!(email: 'second-audit@example.test', name: 'Audit Staff', role: 'staff', password: 'Learning123!')
    post '/api/session', params: {email: @staff.email, password: 'Learning123!'}, as: :json
    assert_response :success
    @issue_attributes = {title: 'Audit request', category: 'roads', latitude: 33, longitude: -97}
    @payload = {type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [-97, 33]}, properties: {title: 'Audit import', category: 'roads'}}]}
  end

  def replace_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  test 'an explicitly null optional description is stored as an empty string' do
    post '/api/issues', params: {issue: @issue_attributes.merge(description: nil)}, as: :json
    assert_response :created
    assert_equal '', Issue.find(response.parsed_body.fetch('issue').fetch('id')).description
  end

  test 'malformed optimistic lock tokens never change the issue' do
    issue = Issue.create!(**@issue_attributes, reporter: @staff)
    [nil, '', 'not-a-version', '0garbage', -1, 0.5, 2**40, (2**40).to_s].each do |version|
      patch "/api/issues/#{issue.id}", params: {issue: {title: 'Unintended overwrite', lock_version: version}}, as: :json
      assert_response :unprocessable_entity
      assert_equal 'Audit request', issue.reload.title
      assert_equal 0, issue.lock_version
    end
  end

  test 'an ambiguous queue acknowledgment cannot overwrite a completed import' do
    enqueue = ->(id) { ImportIssuesJob.perform_now(id); raise IOError, 'Timeout after queue accepted the job' }
    replace_method(ImportIssuesJob, :perform_later, enqueue) do
      post '/api/import_runs', params: {geojson: @payload}, as: :json
      assert_response :accepted
    end
    run = ImportRun.find(response.parsed_body.fetch('import').fetch('id'))
    assert_equal 'completed', run.status
    assert_equal 1, run.imported_count
    assert_nil run.failure
  end

  test 'an ambiguous queue acknowledgment cannot overwrite a completed export' do
    enqueue = ->(id) { ExportIssuesJob.perform_now(id); raise IOError, 'Timeout after queue accepted the job' }
    replace_method(ExportIssuesJob, :perform_later, enqueue) do
      post '/api/export_runs', as: :json
      assert_response :accepted
    end
    run = ExportRun.find(response.parsed_body.fetch('export').fetch('id'))
    assert_equal 'completed', run.status
    assert_not_nil run.content
    assert_nil run.failure
  end

  test 'a concurrent identical import found during uniqueness validation is reused' do
    post '/api/import_runs', params: {geojson: @payload}, as: :json
    assert_response :accepted
    existing_id = response.parsed_body.fetch('import').fetch('id')
    original = ImportRun.method(:find_by)
    first_lookup = true
    lookup = lambda do |*arguments, **keywords|
      if first_lookup
        first_lookup = false
        nil
      else
        original.call(*arguments, **keywords)
      end
    end
    replace_method(ImportRun, :find_by, lookup) do
      assert_no_difference 'ImportRun.count' do
        post '/api/import_runs', params: {geojson: @payload}, as: :json
        assert_response :ok
      end
    end
    assert response.parsed_body.fetch('reused')
    assert_equal existing_id, response.parsed_body.fetch('import').fetch('id')
  end
end
