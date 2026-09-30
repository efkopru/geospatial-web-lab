require 'test_helper'

class ServiceRequestFailureRecoveryTest < ActionDispatch::IntegrationTest
  def with_replaced_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  setup do
    @staff = User.create!(email: 'recovery-staff@example.test', name: 'Recovery Staff', role: 'staff', password: 'Learning123!')
    post '/api/session', params: { email: @staff.email, password: 'Learning123!' }, as: :json
    assert_response :success
    @payload = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-97, 33] }, properties: { title: 'Outage import', category: 'roads' } }] }
  end

  test 'notification failures do not misreport committed writes or prevent background enqueue' do
    outage = ->(*) { raise IOError, 'Synthetic notification outage' }
    with_replaced_method(ActionCable.server, :broadcast, outage) do
      assert_difference 'Issue.count', 1 do
        post '/api/issues', params: { issue: { title: 'Outage report', category: 'roads', latitude: 33, longitude: -97 } }, as: :json
        assert_response :created
      end
      assert_enqueued_with(job: ImportIssuesJob) do
        post '/api/import_runs', params: { geojson: @payload }, as: :json
        assert_response :accepted
      end
      run = ImportRun.find(response.parsed_body['import']['id'])
      ImportIssuesJob.perform_now(run.id)
      assert_equal 'completed', run.reload.status
      assert_equal 1, run.imported_count

      assert_enqueued_with(job: ExportIssuesJob) do
        post '/api/export_runs', as: :json
        assert_response :accepted
      end
      export = ExportRun.find(response.parsed_body['export']['id'])
      ExportIssuesJob.perform_now(export.id)
      assert_equal 'completed', export.reload.status
      assert_equal 2, export.record_count
    end
  end

  test 'duplicate export deliveries cannot race a worker already processing the report' do
    run = ExportRun.create!(requested_by: @staff)
    # Rails pins transactional tests to one connection, including pool checkouts.
    # A separate PostgreSQL session is required to exercise real contention.
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    competing_connection = PG.connect(dbname: config[:database], host: config[:host], port: config[:port], user: config[:username], password: config[:password])
    competing_connection.exec("SELECT pg_advisory_lock(10102, #{run.id})")
    ExportIssuesJob.perform_now(run.id)
    assert_equal 'pending', run.reload.status
    assert_nil run.content
    competing_connection.exec("SELECT pg_advisory_unlock(10102, #{run.id})")
    ExportIssuesJob.perform_now(run.id)
    assert_equal 'completed', run.reload.status
    content = run.content
    ExportIssuesJob.perform_now(run.id)
    assert_equal content, run.reload.content
  ensure
    if competing_connection
      competing_connection.close
    end
  end

  test 'unexpected worker failures expose actionable messages without private exception details' do
    run = ImportRun.create!(requested_by: @staff, digest: 'corrupt-source', payload: {})
    assert_raises(KeyError) { ImportIssuesJob.new.perform(run.id) }
    assert_equal 'failed', run.reload.status
    assert_match(/Retry processing/, run.failure)
    assert_no_match(/key not found|features/, run.failure)

    export = ExportRun.create!(requested_by: @staff)
    with_replaced_method(Issue, :visible_to, ->(*) { raise 'postgres://private:secret@internal' }) do
      assert_raises(RuntimeError) { ExportIssuesJob.new.perform(export.id) }
    end
    assert_equal 'failed', export.reload.status
    assert_no_match(/private|secret|postgres/, export.failure)
  end

  test 'cancelled import and export enqueueing returns unavailable and persists retryable failure' do
    adapter = Object.new
    def adapter.enqueue(job) = raise(ActiveJob::EnqueueError, 'Synthetic cancelled enqueue')
    def adapter.enqueue_at(job, timestamp) = enqueue(job)
    previous_import = ImportIssuesJob.queue_adapter
    previous_export = ExportIssuesJob.queue_adapter
    ImportIssuesJob.queue_adapter = adapter
    ExportIssuesJob.queue_adapter = adapter
    post '/api/import_runs', params: {geojson: @payload}, as: :json
    assert_response :service_unavailable
    run = ImportRun.find(response.parsed_body.fetch('import').fetch('id'))
    assert_equal 'failed', run.status
    assert_match(/Retry/, run.failure)
    post "/api/import_runs/#{run.id}/retry", as: :json
    assert_response :service_unavailable
    assert_equal 'failed', run.reload.status
    post '/api/export_runs', as: :json
    assert_response :service_unavailable
    export = ExportRun.find(response.parsed_body.fetch('export').fetch('id'))
    assert_equal 'failed', export.status
    assert_match(/Generate a new report/, export.failure)
  ensure
    ImportIssuesJob.queue_adapter = previous_import if previous_import
    ExportIssuesJob.queue_adapter = previous_export if previous_export
  end

  test 'scalar and array issue bodies return bad request without creating or modifying issues' do
    issue = Issue.create!(reporter: @staff, title: 'Preserved issue', category: 'roads', latitude: 33, longitude: -97)
    original = issue.attributes
    ['invalid', 42, ['invalid']].each do |value|
      assert_no_difference 'Issue.count' do
        post '/api/issues', params: {issue: value}, as: :json
        assert_response :bad_request
      end
      patch "/api/issues/#{issue.id}", params: {issue: value}, as: :json
      assert_response :bad_request
      assert_equal original, issue.reload.attributes
    end
  end
end
