require 'test_helper'

module ScenarioAuditHelpers
  def with_replaced_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  def create_test_parcel
    Parcel.create!(name: 'Audit parcel', district: 'Test', height_limit: 4,
      boundary: {type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]]})
  end
end

class ScenarioFailureRecoveryTest < ActiveSupport::TestCase
  include ScenarioAuditHelpers

  setup do
    @user = User.create!(email: 'scenario-audit@example.test', name: 'Planner', password: 'Learning123!', role: 'staff')
    @parcel = create_test_parcel
    @scenario = Scenario.create!(user: @user, name: 'Audit scenario', parcel_ids: [@parcel.id], floors: 2, coverage: 0.5, unit_area: 900)
  end

  test 'notification transport failure leaves completed calculations exportable' do
    with_replaced_method(ActionCable.server, :broadcast, ->(*) { raise IOError, 'Transport unavailable' }) do
      CalculateScenarioJob.perform_now(@scenario.id, @scenario.revision)
    end
    assert_equal 'complete', @scenario.reload.status
    assert @scenario.results.fetch('units').positive?
    assert_nil @scenario.error_message
  end

  test 'calculation failure persists a sanitized retryable state' do
    with_replaced_method(ScenarioCalculator, :call, ->(*) { raise 'postgres://private:password@internal' }) do
      assert_raises(RuntimeError) { CalculateScenarioJob.perform_now(@scenario.id, @scenario.revision) }
    end
    assert_equal 'failed', @scenario.reload.status
    assert_match(/Retry/, @scenario.error_message)
    assert_no_match(/postgres|private|password/, @scenario.error_message)
    assert_equal({}, @scenario.results)
  end

  test 'a failed earlier revision cannot overwrite a newer completed revision' do
    original_where = Scenario.method(:where)
    scenario = @scenario
    advanced = false
    # Simulate another worker committing in the gap after the failed transaction
    # releases its row lock and before its failure handler writes status.
    find_failure_scope = ->(conditions) do
      # An uncached find_by can also delegate to where. Advance only when the
      # failure handler targets this unfinished revision, after calculation.
      if !advanced && conditions == {id: scenario.id, revision: 1, status: %w[queued processing]}
        advanced = true
        scenario.reload.update_columns(revision: 2, status: 'complete', results: {'units' => 42}, error_message: nil)
      end
      original_where.call(conditions)
    end
    with_replaced_method(ScenarioCalculator, :call, ->(*) { raise 'Old calculation failed' }) do
      with_replaced_method(Scenario, :where, find_failure_scope) do
        assert_raises(RuntimeError) { CalculateScenarioJob.perform_now(@scenario.id, 1) }
      end
    end
    assert advanced
    assert_equal 2, @scenario.reload.revision
    assert_equal 'complete', @scenario.status
    assert_equal({'units' => 42}, @scenario.results)
    assert_nil @scenario.error_message
  end
end

class ScenarioRetryApiTest < ActionDispatch::IntegrationTest
  include ScenarioAuditHelpers

  setup do
    @user = User.create!(email: 'scenario-api-audit@example.test', name: 'Planner', password: 'Learning123!', role: 'staff')
    @parcel = create_test_parcel
    @attributes = {name: 'Audit scenario', parcel_ids: [@parcel.id], floors: 2, coverage: 0.5, unit_area: 900}
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'malformed scalar and array scenario parameters return bad request without persistence' do
    ['invalid', 42, ['invalid']].each do |value|
      assert_no_difference 'Scenario.count' do
        post '/api/scenarios', params: {scenario: value}, as: :json
        assert_response :bad_request
      end
    end
  end

  test 'enqueue errors swallowed by ActiveJob still mark saved scenarios failed' do
    adapter = Object.new
    def adapter.enqueue(job) = raise(ActiveJob::EnqueueError, 'Synthetic cancelled enqueue')
    def adapter.enqueue_at(job, timestamp) = enqueue(job)
    previous = CalculateScenarioJob.queue_adapter
    CalculateScenarioJob.queue_adapter = adapter
    post '/api/scenarios', params: {scenario: @attributes}, as: :json
    assert_response :created
    scenario = Scenario.find(response.parsed_body.fetch('id'))
    assert_equal 'failed', scenario.status
    assert_match(/Retry/, response.parsed_body['error_message'])
    post "/api/scenarios/#{scenario.id}/recalculate", as: :json
    assert_response :success
    assert_equal 'failed', scenario.reload.status
    assert_equal 2, scenario.revision
  ensure
    CalculateScenarioJob.queue_adapter = previous if previous
  end

  test 'only failed scenarios can retry and completed exported snapshots remain unchanged' do
    scenario = Scenario.create!(@attributes.merge(user: @user))
    %w[queued processing].each do |status|
      scenario.update!(status: status)
      assert_no_enqueued_jobs do
        post "/api/scenarios/#{scenario.id}/recalculate", as: :json
        assert_response :conflict
      end
      assert_equal 1, scenario.reload.revision
      assert_equal status, scenario.status
    end
    scenario.update!(status: 'queued')
    CalculateScenarioJob.perform_now(scenario.id, 1)
    get "/api/scenarios/#{scenario.id}/export"
    assert_response :success
    original_export = response.body
    @parcel.update!(height_limit: 1)
    assert_no_enqueued_jobs do
      post "/api/scenarios/#{scenario.id}/recalculate", as: :json
      assert_response :conflict
    end
    get "/api/scenarios/#{scenario.id}/export"
    assert_equal original_export, response.body
    failed = Scenario.create!(@attributes.merge(user: @user, status: 'failed', error_message: 'Interrupted'))
    assert_enqueued_with(job: CalculateScenarioJob, args: [failed.id, 2]) do
      post "/api/scenarios/#{failed.id}/recalculate", as: :json
      assert_response :success
    end
    assert_equal 'queued', failed.reload.status
    assert_nil failed.error_message
  end
end
