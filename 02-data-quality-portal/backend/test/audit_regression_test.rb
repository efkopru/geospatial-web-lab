require 'test_helper'

class DatasetEnqueueRecoveryTest < ActionDispatch::IntegrationTest
  test 'cancelled enqueueing marks new and retried dataset validations failed' do
    user = User.create!(name: 'Queue tester', email: 'dataset-queue-audit@example.test', password: 'Learning123!', role: 'reporter')
    post '/api/session', params: {email: user.email, password: 'Learning123!'}, as: :json
    assert_response :success
    adapter = Object.new
    def adapter.enqueue(job) = raise(ActiveJob::EnqueueError, 'Synthetic cancelled enqueue')
    def adapter.enqueue_at(job, timestamp) = enqueue(job)
    previous = ValidateDatasetJob.queue_adapter
    ValidateDatasetJob.queue_adapter = adapter
    source = Rails.root.join('samples', 'parks-clean.geojson').read
    post '/api/datasets', params: {name: 'Cancelled validation', source: source}, as: :json
    assert_response :created
    dataset = Dataset.find(response.parsed_body.fetch('dataset').fetch('id'))
    assert_equal 'failed', dataset.status
    assert_match(/Retry/, dataset.failure_message)
    post "/api/datasets/#{dataset.id}/retry", as: :json
    assert_response :unprocessable_entity
    assert_match(/Retry/, response.parsed_body.fetch('error'))
    assert_equal 'failed', dataset.reload.status
    assert_equal 0, dataset.dataset_records.count
  ensure
    ValidateDatasetJob.queue_adapter = previous if previous
  end
end
