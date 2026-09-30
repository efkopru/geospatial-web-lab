require "digest"

class Dataset < ApplicationRecord
  MAX_FEATURES = 2_000
  MAX_SOURCE_BYTES = 5.megabytes
  belongs_to :user
  has_many :dataset_records, dependent: :destroy
  has_one :dataset_version
  validates :name, presence: true, length: { maximum: 120 }
  validates :status, inclusion: { in: %w[queued validating ready approved failed] }
  validates :source_digest, presence: true, uniqueness: { scope: :user_id }

  def self.import!(user:, name:, source_text:, required_attributes: ["asset_id"])
    raise ArgumentError, "GeoJSON must be supplied as text" unless source_text.is_a?(String)
    raise ArgumentError, "File exceeds the 5 MB limit" if source_text.bytesize > MAX_SOURCE_BYTES
    source = JSON.parse(source_text)
    unless source.is_a?(Hash) && source["type"] == "FeatureCollection" && source["features"].is_a?(Array)
      raise ArgumentError, "Expected a GeoJSON FeatureCollection with a features array"
    end
    unless source["features"].size.between?(1, MAX_FEATURES)
      raise ArgumentError, "Upload must contain 1 to #{MAX_FEATURES} features"
    end
    unless required_attributes.is_a?(Array) && required_attributes.all? { |attribute| attribute.is_a?(String) }
      raise ArgumentError, "Required attributes must be an array of attribute names"
    end
    attributes = required_attributes.map(&:strip).reject(&:empty?).uniq.sort
    if attributes.size > 10 || attributes.any? { |value| !value.match?(/\A[a-zA-Z_][a-zA-Z0-9_]{0,49}\z/) }
      raise ArgumentError, "Specify at most 10 attribute names using letters, digits, and underscores"
    end
    fingerprint = Digest::SHA256.hexdigest(JSON.generate([canonical(source), attributes]))
    existing = find_by(user: user, source_digest: fingerprint)
    return [existing, false] if existing
    dataset = create!(user: user, name: name, source: source, required_attributes: attributes,
                      source_digest: fingerprint, total_count: source["features"].size)
    [dataset, true]
  rescue JSON::ParserError
    raise ArgumentError, "File is not valid JSON"
  rescue ActiveRecord::RecordNotUnique
    [find_by!(user: user, source_digest: fingerprint), false]
  rescue ActiveRecord::RecordInvalid => error
    # A concurrent upload may become visible to uniqueness validation after
    # the initial lookup. It must have the same reuse behavior as a unique-index race.
    raise unless error.record.is_a?(Dataset) && error.record.errors.attribute_names == [:source_digest] && error.record.errors.of_kind?(:source_digest, :taken)
    [find_by!(user: user, source_digest: fingerprint), false]
  end

  def self.canonical(value)
    case value
    when Hash then value.keys.sort.to_h { |key| [key, canonical(value[key])] }
    when Array then value.map { |item| canonical(item) }
    else value
    end
  end

  def summary
    as_json(only: %i[id name status total_count processed_count valid_count invalid_count required_attributes failure_message created_at updated_at]).merge(
      "owner" => user.name,
      "version" => dataset_version&.as_json(only: %i[id digest feature_count created_at])
    )
  end

  def broadcast_progress
    DatasetChannel.broadcast_to(user, { dataset_id: id, status: status, processed_count: processed_count })
    ActionCable.server.broadcast("dataset_staff", { dataset_id: id, status: status, processed_count: processed_count })
  rescue StandardError => error
    # Notifications are recoverable: clients poll authoritative database state.
    # A Redis interruption must never undo a successful validation or approval.
    Rails.logger.warn("Dataset #{id} notification unavailable: #{error.class}")
  end

  def approve!(approver:, acknowledge_rejected: false)
    raise ArgumentError, "Only staff may approve datasets" unless approver.role == "staff"
    with_lock do
      return dataset_version if status == "approved"
      raise ArgumentError, "Validation must finish before approval" unless status == "ready"
      raise ArgumentError, "At least one valid feature is required" if valid_count.zero?
      if invalid_count.positive? && !acknowledge_rejected
        raise ArgumentError, "Acknowledge excluded rejected features before approval"
      end
      features = dataset_records.where(accepted: true).order(:ordinal).map(&:feature)
      content = Dataset.canonical({ "type" => "FeatureCollection", "features" => features })
      export_json = JSON.generate(content)
      version = create_dataset_version!(approved_by: approver, content: content,
                                         export_json: export_json, digest: Digest::SHA256.hexdigest(export_json), feature_count: features.size)
      update!(status: "approved")
      version
    end
  end
end
