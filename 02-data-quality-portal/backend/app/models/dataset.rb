require "digest"

class Dataset < ApplicationRecord
  MAX_FEATURES = 2_000
  MAX_SOURCE_BYTES = 5.megabytes
  belongs_to :user
  has_many :dataset_records, dependent: :destroy
  has_one :dataset_version
  validates :name, presence: true, length: { maximum: 120 }, format: { without: /\u0000/, message: "cannot contain the NUL character" }
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
    if (location = unstorable_text_location(source))
      raise ArgumentError, "#{location} contains the NUL character (\\u0000), which cannot be stored. Remove it and upload again."
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

  # PostgreSQL text and jsonb cannot store U+0000, which valid JSON may encode as \u0000. Every
  # key and string value is checked so the upload is rejected with its location, not on insert.
  def self.unstorable_text_location(value, path = nil)
    case value
    when Hash
      value.each do |key, item|
        return "A property name in #{path || 'the file'}" unless storable_text?(key)
        found = unstorable_text_location(item, [path, key].compact.join("."))
        return found if found
      end
    when Array
      value.each_with_index do |item, index|
        found = unstorable_text_location(item, "#{path}[#{index}]")
        return found if found
      end
    when String
      return "The value at #{path}" unless storable_text?(value)
    end
    nil
  end

  def self.storable_text?(text)
    text.valid_encoding? && !text.include?("\u0000")
  end

  # The session advisory lock ValidateDatasetJob holds while it validates this dataset.
  def self.validation_lock_key(id) = 720_000_000 + id

  # A dataset is abandoned when it is still marked validating but no worker holds its lock, for
  # example after a worker process was killed: PostgreSQL releases a session lock when its
  # connection ends. pg_locks shows a bigint key's high half as classid and its low half as objid.
  # Reading pg_locks, rather than taking the lock, never blocks a worker that is starting.
  def abandoned?
    return false unless status == "validating"
    key = Dataset.validation_lock_key(id)
    !Dataset.connection.select_value(Dataset.sanitize_sql_array([<<~SQL, key >> 32, key & 0xFFFF_FFFF]))
      SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = ? AND objid = ? AND objsubid = 1)
    SQL
  end

  def self.canonical(value)
    case value
    when Hash then value.keys.sort.to_h { |key| [key, canonical(value[key])] }
    when Array then value.map { |item| canonical(item) }
    else value
    end
  end

  # Columns a summary needs. The source GeoJSON and a version's stored export can each be
  # megabytes, so listing and detail reads load only these.
  SUMMARY_COLUMNS = %i[id user_id name status total_count processed_count valid_count invalid_count required_attributes failure_message created_at updated_at].freeze
  VERSION_SUMMARY_COLUMNS = %i[id dataset_id digest feature_count created_at].freeze

  def self.select_summary
    select(*SUMMARY_COLUMNS.map { |column| arel_table[column] })
  end

  def self.version_summaries(ids)
    DatasetVersion.where(dataset_id: ids).select(*VERSION_SUMMARY_COLUMNS).index_by(&:dataset_id)
  end

  def summary(version: dataset_version)
    as_json(only: %i[id name status total_count processed_count valid_count invalid_count required_attributes failure_message created_at updated_at]).merge(
      "owner" => user.name,
      "abandoned" => abandoned?,
      "version" => version&.as_json(only: %i[id digest feature_count created_at])
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
