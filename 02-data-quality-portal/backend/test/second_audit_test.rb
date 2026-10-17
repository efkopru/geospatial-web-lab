require 'test_helper'

class DatasetSecondAuditTest < ActionDispatch::IntegrationTest
  setup do
    @reporter = User.create!(email: 'second-audit@example.test', name: 'Audit Reporter', role: 'reporter', password: 'Learning123!')
    post '/api/session', params: {email: @reporter.email, password: 'Learning123!'}, as: :json
    assert_response :success
    @source = Rails.root.join('samples', 'parks-clean.geojson').read
  end

  def replace_method(object, name, replacement)
    original = object.method(name)
    object.define_singleton_method(name, &replacement)
    yield
  ensure
    object.define_singleton_method(name, original)
  end

  test 'malformed required attribute collections are rejected without server errors' do
    [{asset_id: true}, [{nested: 'asset_id'}], nil, 7].each do |rules|
      assert_no_difference 'Dataset.count' do
        post '/api/datasets', params: {name: 'Bad rules', source: @source, required_attributes: rules}, as: :json
        assert_response :unprocessable_entity
      end
    end
  end

  test 'an escaped NUL anywhere in the source is rejected with its location before anything is stored' do
    feature = ->(properties) { {type: 'FeatureCollection', features: [{type: 'Feature', properties: properties, geometry: {type: 'Point', coordinates: [-97, 33]}}]} }
    {
      {asset_id: 'review-1', name: "harmless\u0000text"} => 'The value at features[0].properties.name',
      {asset_id: 'review-1', details: {notes: ["fine", "bad\u0000"]}} => 'The value at features[0].properties.details.notes[1]',
      {asset_id: 'review-1', "key\u0000" => 'value'} => 'A property name in features[0].properties'
    }.each do |properties, location|
      assert_no_difference ['Dataset.count', 'DatasetRecord.count'] do
        post '/api/datasets', params: {name: 'NUL check', source: JSON.generate(feature.call(properties))}, as: :json
      end
      assert_response :unprocessable_entity
      assert_equal "#{location} contains the NUL character (\\u0000), which cannot be stored. Remove it and upload again.", response.parsed_body['error']
    end
    assert_no_difference 'Dataset.count' do
      post '/api/datasets', params: {name: "Name\u0000", source: @source}, as: :json
    end
    assert_response :unprocessable_entity
    assert_match 'Name cannot contain the NUL character', response.parsed_body['error']
  end

  test 'ordinary Unicode in names, keys and values is stored unchanged' do
    source = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {asset_id: 'u-1', '名前' => 'Café ✓ Zürich 東京 😀'}, geometry: {type: 'Point', coordinates: [-97, 33]}}]}
    post '/api/datasets', params: {name: 'Ünïcode parks 🌳', source: JSON.generate(source)}, as: :json
    assert_response :created
    dataset = Dataset.find(response.parsed_body.dig('dataset', 'id'))
    assert_equal 'Ünïcode parks 🌳', dataset.name
    assert_equal 'Café ✓ Zürich 東京 😀', dataset.source.dig('features', 0, 'properties', '名前')
  end

  test 'an ambiguous queue acknowledgment preserves completed validation' do
    enqueue = ->(id) { ValidateDatasetJob.perform_now(id); raise IOError, 'Timeout after queue accepted the job' }
    replace_method(ValidateDatasetJob, :perform_later, enqueue) do
      post '/api/datasets', params: {name: 'Queue acknowledgment', source: @source}, as: :json
      assert_response :created
    end
    dataset = Dataset.find(response.parsed_body.fetch('dataset').fetch('id'))
    assert_equal 'ready', dataset.status
    assert_equal 4, dataset.valid_count
    assert_nil dataset.failure_message
  end

  test 'a retry enqueue timeout preserves a validation already completed by the worker' do
    dataset, = Dataset.import!(user: @reporter, name: 'Retry queue acknowledgment', source_text: @source)
    dataset.update!(status: 'failed')
    enqueue = ->(id) { ValidateDatasetJob.perform_now(id); raise IOError, 'Timeout after queue accepted the job' }
    replace_method(ValidateDatasetJob, :perform_later, enqueue) do
      post "/api/datasets/#{dataset.id}/retry", as: :json
      assert_response :success
    end
    assert_equal 'ready', dataset.reload.status
    assert_nil dataset.failure_message
  end

  test 'a concurrent equivalent upload found during uniqueness validation is reused' do
    dataset, = Dataset.import!(user: @reporter, name: 'First upload', source_text: @source)
    original = Dataset.method(:find_by)
    first_lookup = true
    lookup = lambda do |*arguments, **keywords|
      if first_lookup
        first_lookup = false
        nil
      else
        original.call(*arguments, **keywords)
      end
    end
    replace_method(Dataset, :find_by, lookup) do
      assert_no_difference 'Dataset.count' do
        post '/api/datasets', params: {name: 'Concurrent upload', source: @source}, as: :json
        assert_response :ok
      end
    end
    assert response.parsed_body.fetch('duplicate')
    assert_equal dataset.id, response.parsed_body.fetch('dataset').fetch('id')
  end
end
