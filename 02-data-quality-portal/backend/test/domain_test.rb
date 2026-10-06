require "test_helper"

class DatasetDomainTest < ActiveSupport::TestCase
  setup do
    @reporter = User.create!(name: "Test Reporter", email: "reporter-#{SecureRandom.hex(4)}@example.test", password: "Learning123!", role: "reporter")
    @staff = User.create!(name: "Test Reviewer", email: "staff-#{SecureRandom.hex(4)}@example.test", password: "Learning123!", role: "staff")
  end

  def feature(geometry = { "type" => "Point", "coordinates" => [-97.0, 33.0] }, properties = { "asset_id" => "A-1" })
    { "type" => "Feature", "properties" => properties, "geometry" => geometry }
  end

  def import(features = [feature], attributes: ["asset_id"])
    Dataset.import!(user: @reporter, name: "Test upload", source_text: JSON.generate({ type: "FeatureCollection", features: features }), required_attributes: attributes).first
  end

  test "malformed inputs and source limits are rejected before a dataset is created" do
    ["not JSON", "[]", '{"type":"Feature"}', '{"type":"FeatureCollection","features":[]}'].each do |text|
      assert_raises(ArgumentError) { Dataset.import!(user: @reporter, name: "Bad", source_text: text) }
    end
    assert_raises(ArgumentError) { Dataset.import!(user: @reporter, name: "Large", source_text: "x" * (Dataset::MAX_SOURCE_BYTES + 1)) }
    assert_raises(ArgumentError) { import(Array.new(Dataset::MAX_FEATURES + 1) { feature }) }
    assert_raises(ArgumentError) { import(attributes: ["invalid key"]) }
    assert_equal 0, Dataset.where(user: @reporter).count
  end

  test "repeated uploads use a canonical fingerprint and create one dataset" do
    original = import
    source = { "features" => [feature], "type" => "FeatureCollection" }
    same, created = Dataset.import!(user: @reporter, name: "Different filename", source_text: JSON.pretty_generate(source))
    assert_equal original.id, same.id
    assert_equal false, created
    different_rules = import(attributes: ["asset_id", "name"])
    assert_not_equal original.id, different_rules.id
  end

  test "all documented geometry types pass structural and PostGIS checks" do
    ring = [[-97.0, 33.0], [-96.9, 33.0], [-96.9, 33.1], [-97.0, 33.1], [-97.0, 33.0]]
    geometries = [
      { type: "Point", coordinates: [-97.0, 33.0] },
      { type: "MultiPoint", coordinates: [[-97.0, 33.0], [-96.9, 33.1]] },
      { type: "LineString", coordinates: [[-97.0, 33.0], [-96.9, 33.1]] },
      { type: "MultiLineString", coordinates: [[[-97.0, 33.0], [-96.9, 33.1]]] },
      { type: "Polygon", coordinates: [ring] },
      { type: "MultiPolygon", coordinates: [[ring]] }
    ]
    dataset = import(geometries.map { |geometry| feature(geometry) })
    ValidateDatasetJob.perform_now(dataset.id)
    dataset.reload
    assert_equal "ready", dataset.status
    assert_equal 6, dataset.valid_count
    assert_equal 0, dataset.invalid_count
    assert_equal 6, DatasetRecord.connection.select_value("SELECT COUNT(*) FROM dataset_records WHERE dataset_id = #{dataset.id} AND ST_IsValid(geom)")
  end

  test "bad attributes coordinates rings geometry collections and null records are rejected individually" do
    dataset = import([
      feature,
      feature({ "type" => "Point", "coordinates" => [-97, 95] }),
      feature({ "type" => "Point", "coordinates" => [-197, 33] }),
      feature({ "type" => "Point", "coordinates" => ["-97", 33] }),
      feature({ "type" => "Point", "coordinates" => [-97, 33, 100] }),
      feature({ "type" => "Polygon", "coordinates" => [[[0, 0], [1, 0], [1, 1], [0, 1]]] }),
      feature({ "type" => "Polygon", "coordinates" => [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] }),
      feature({ "type" => "GeometryCollection", "geometries" => [] }),
      feature({ "type" => "Point", "coordinates" => [-97, 33] }, { "asset_id" => " " }),
      nil
    ])
    ValidateDatasetJob.perform_now(dataset.id)
    dataset.reload
    assert_equal "ready", dataset.status
    assert_equal 1, dataset.valid_count
    assert_equal 9, dataset.invalid_count
    errors = dataset.dataset_records.where(accepted: false).flat_map(&:validation_errors).join(" ")
    assert_match(/Latitude/, errors)
    assert_match(/Longitude/, errors)
    assert_match(/finite numbers/, errors)
    assert_match(/closed/, errors)
    assert_match(/Self-intersection/, errors)
    assert_match(/Unsupported geometry/, errors)
    assert_match(/asset_id/, errors)
  end

  test "job retry reuses record ordinals and completed jobs are no ops" do
    dataset = import([feature, feature({ "type" => "Point", "coordinates" => [-97.1, 33.1] })])
    dataset.dataset_records.create!(ordinal: 0, feature: feature, accepted: false, validation_errors: ["Interrupted"])
    dataset.update!(status: "failed")
    ValidateDatasetJob.perform_now(dataset.id)
    original_ids = dataset.dataset_records.order(:ordinal).pluck(:id)
    ValidateDatasetJob.perform_now(dataset.id)
    assert_equal 2, dataset.dataset_records.count
    assert_equal original_ids, dataset.dataset_records.order(:ordinal).pluck(:id)
    assert_equal 2, dataset.reload.processed_count
  end

  test "database rejects accepted records without valid stored geometry" do
    dataset = import
    assert_raises(ActiveRecord::StatementInvalid) do
      DatasetRecord.transaction(requires_new: true) do
        dataset.dataset_records.create!(ordinal: 0, feature: feature, accepted: true)
      end
    end
  end

  test "unexpected worker failures persist a failed state without exposing source or SQL" do
    dataset = import
    dataset.update!(source: { "unexpected" => "Simulated corrupted source" })
    assert_raises(KeyError) { ValidateDatasetJob.perform_now(dataset.id) }
    assert_equal "failed", dataset.reload.status
    assert_match(/Retry processing/, dataset.failure_message)
    assert_no_match(/Simulated corrupted source/, dataset.failure_message)
  end

  test "approval requires completed validation valid records staff and acknowledgment of exclusions" do
    dataset = import([feature, feature(nil)])
    assert_raises(ArgumentError) { dataset.approve!(approver: @staff) }
    ValidateDatasetJob.perform_now(dataset.id)
    dataset.reload
    assert_raises(ArgumentError) { dataset.approve!(approver: @reporter, acknowledge_rejected: true) }
    assert_raises(ArgumentError) { dataset.approve!(approver: @staff) }
    version = dataset.approve!(approver: @staff, acknowledge_rejected: true)
    assert_equal 1, version.feature_count
    assert_equal [feature], version.content["features"]
    assert_equal version.id, dataset.approve!(approver: @staff).id
    assert_equal "approved", dataset.reload.status
    assert_raises(ActiveRecord::ReadOnlyRecord) { version.update!(digest: "changed") }
    assert_raises(ActiveRecord::StatementInvalid) do
      DatasetVersion.transaction(requires_new: true) { DatasetVersion.where(id: version.id).update_all(digest: "changed") }
    end
    empty = import([feature(nil)])
    ValidateDatasetJob.perform_now(empty.id)
    assert_raises(ArgumentError) { empty.reload.approve!(approver: @staff, acknowledge_rejected: true) }
  end
end

class DatasetApiTest < ActionDispatch::IntegrationTest
  setup do
    @reporter = User.create!(name: "Uploader", email: "uploader-#{SecureRandom.hex(4)}@example.test", password: "Learning123!", role: "reporter")
    @staff = User.create!(name: "Reviewer", email: "reviewer-#{SecureRandom.hex(4)}@example.test", password: "Learning123!", role: "staff")
    @source = Rails.root.join("samples", "parks-clean.geojson").read
  end

  def login(user)
    post "/api/session", params: { email: user.email, password: "Learning123!" }, as: :json
    assert_response :success
  end

  test "authenticated upload review approval and immutable export work end to end" do
    get "/api/datasets"
    assert_response :unauthorized
    login(@reporter)
    perform_enqueued_jobs do
      post "/api/datasets", params: { name: "Park inventory", source: @source, required_attributes: ["asset_id"] }, as: :json
      assert_response :created
    end
    id = response.parsed_body.fetch("dataset").fetch("id")
    get "/api/datasets/#{id}"
    assert_response :success
    assert_equal 4, response.parsed_body["valid_count"]
    get "/api/datasets/#{id}/export"
    assert_response :unprocessable_entity
    post "/api/datasets/#{id}/approve", params: {}, as: :json
    assert_response :forbidden
    login(@staff)
    post "/api/datasets/#{id}/approve", params: {}, as: :json
    assert_response :success
    get "/api/datasets/#{id}/export"
    assert_response :success
    assert_equal "application/geo+json", response.media_type
    content = JSON.parse(response.body)
    assert_equal 4, content["features"].size
    assert_equal Digest::SHA256.hexdigest(response.body), response.headers["X-Content-SHA256"]
    post "/api/datasets/#{id}/retry", params: {}, as: :json
    assert_response :unprocessable_entity
  end

  test "listing and showing datasets do not load stored sources or exports" do
    dataset, = Dataset.import!(user: @staff, name: "Large source", source_text: @source)
    perform_enqueued_jobs { ValidateDatasetJob.perform_later(dataset.id) }
    version = dataset.reload.approve!(approver: @staff)
    login(@staff)
    statements = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| statements << payload[:sql] }
    begin
      get "/api/datasets"
      assert_response :success
      listed = response.parsed_body.fetch("datasets").find { |item| item["id"] == dataset.id }
      assert_equal "approved", listed["status"]
      assert_equal version.digest, listed.dig("version", "digest")
      get "/api/datasets/#{dataset.id}"
      assert_response :success
      assert_equal 4, response.parsed_body["records"].size
      assert_equal version.id, response.parsed_body.dig("version", "id")
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end
    reads = statements.grep(/\ASELECT/i).grep(/"datasets"|"dataset_versions"/)
    assert reads.any?
    assert reads.none? { |sql| sql.include?('"datasets".*') || sql.include?('"dataset_versions".*') }, reads.join("\n")
  end

  test "reporters cannot read another reporters datasets or exports" do
    dataset, = Dataset.import!(user: @staff, name: "Private upload", source_text: @source)
    login(@reporter)
    get "/api/datasets/#{dataset.id}"
    assert_response :not_found
    get "/api/datasets/#{dataset.id}/export"
    assert_response :not_found
  end

  test "malformed JSON returns actionable error and retries enqueue failed datasets" do
    login(@reporter)
    post "/api/datasets", params: { name: "Bad", source: "{bad" }, as: :json
    assert_response :unprocessable_entity
    assert_match(/valid JSON/, response.parsed_body["error"])
    dataset, = Dataset.import!(user: @reporter, name: "Failed import", source_text: @source)
    dataset.update!(status: "failed", failure_message: "Simulated worker outage")
    assert_enqueued_with(job: ValidateDatasetJob, args: [dataset.id]) do
      post "/api/datasets/#{dataset.id}/retry", params: {}, as: :json
      assert_response :success
    end
    assert_equal "queued", dataset.reload.status
  end

  test "a failed validation is left for the user instead of Sidekiq retries" do
    assert_equal false, ValidateDatasetJob.get_sidekiq_options["retry"]
  end
end
