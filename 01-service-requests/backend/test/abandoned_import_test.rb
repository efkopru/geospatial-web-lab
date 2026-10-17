require 'test_helper'

# Abrupt worker loss is simulated as the issue describes: an Exception subclass, which the job's
# StandardError handling does not catch, is raised after the job has committed 'processing'. The
# job's ensure block still releases its advisory lock, as PostgreSQL does when a killed worker's
# connection ends.
class AbandonedImportTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  class SimulatedWorkerLoss < Exception; end # rubocop:disable Lint/InheritException

  setup do
    @staff = User.create!(email: 'abandoned-import@example.test', name: 'Import Staff', role: 'staff', password: 'Learning123!')
    post '/api/session', params: {email: @staff.email, password: 'Learning123!'}, as: :json
    assert_response :success
    @payload = {type: 'FeatureCollection', features: [
      {type: 'Feature', geometry: {type: 'Point', coordinates: [-97, 33]}, properties: {title: 'Recovered one', category: 'roads'}},
      {type: 'Feature', geometry: {type: 'Point', coordinates: [-97.1, 33.1]}, properties: {title: 'Recovered two', category: 'parks'}}
    ]}
  end

  def replace_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  # Uploads the payload and runs its job until the worker is "lost" after the first imported row.
  def interrupted_import
    post '/api/import_runs', params: {geojson: @payload}, as: :json
    assert_response :accepted
    run = ImportRun.find(response.parsed_body.dig('import', 'id'))
    clear_enqueued_jobs
    created = 0
    original = Issue.method(:create!)
    interrupt = ->(*args, **options) { (created += 1) > 1 ? raise(SimulatedWorkerLoss) : original.call(*args, **options) }
    replace_method(Issue, :create!, interrupt) do
      assert_raises(SimulatedWorkerLoss) { ImportIssuesJob.perform_now(run.id) }
    end
    assert_equal 'processing', run.reload.status
    run
  end

  # Holds the job's advisory lock from a separate database session, as a live worker would.
  def with_worker_holding_lock(run)
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    worker = PG.connect(host: config[:host], port: config[:port], dbname: config[:database], user: config[:username], password: config[:password])
    worker.exec_params('SELECT pg_advisory_lock($1, $2)', [ImportRun::ADVISORY_LOCK_KEY, run.id])
    yield
  ensure
    worker&.close
  end

  test 'an import abandoned while processing is reported, resumed through retry, and completes without duplicates' do
    run = interrupted_import
    assert_equal 1, Issue.where("source_key LIKE 'import:#{run.id}:%'").count
    get '/api/import_runs'
    assert_equal true, response.parsed_body['imports'].find { |item| item['id'] == run.id }['abandoned']

    post "/api/import_runs/#{run.id}/retry", as: :json
    assert_response :accepted
    assert_enqueued_jobs 1, only: ImportIssuesJob
    perform_enqueued_jobs
    run.reload
    assert_equal ['completed', 2, 2], [run.status, run.processed_count, run.imported_count]
    assert_equal ['Recovered one', 'Recovered two'], Issue.where("source_key LIKE 'import:#{run.id}:%'").order(:source_key).pluck(:title)
    assert_equal false, run.abandoned?
  end

  test 'uploading the same file again resumes an abandoned import' do
    run = interrupted_import
    post '/api/import_runs', params: {geojson: @payload}, as: :json
    assert_response :success
    assert_equal [true, run.id], [response.parsed_body['reused'], response.parsed_body.dig('import', 'id')]
    assert_enqueued_jobs 1, only: ImportIssuesJob
    perform_enqueued_jobs
    assert_equal 'completed', run.reload.status
    assert_equal 2, Issue.where("source_key LIKE 'import:#{run.id}:%'").count
  end

  test 'an import whose worker still holds its lock is not restarted' do
    run = interrupted_import
    with_worker_holding_lock(run) do
      assert_equal false, run.abandoned?
      post "/api/import_runs/#{run.id}/retry", as: :json
      assert_response :conflict
      assert_equal 'This import is still being processed.', response.parsed_body['error']
      post '/api/import_runs', params: {geojson: @payload}, as: :json
      assert_response :success
      assert_equal false, response.parsed_body.dig('import', 'abandoned')
      assert_no_enqueued_jobs only: ImportIssuesJob
      assert_equal 'processing', run.reload.status
    end
    assert run.abandoned?, 'Once the worker session ends, the run counts as abandoned'
  end
end
