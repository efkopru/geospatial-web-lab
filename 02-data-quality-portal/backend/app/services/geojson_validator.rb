class GeojsonValidator
  SUPPORTED = %w[Point MultiPoint LineString MultiLineString Polygon MultiPolygon].freeze

  def initialize(required_attributes: [])
    @required_attributes = required_attributes
  end

  def errors_for(feature)
    return ["Record must be a GeoJSON Feature object"] unless feature.is_a?(Hash) && feature["type"] == "Feature"
    errors = []
    properties = feature["properties"]
    if !properties.is_a?(Hash)
      errors << "Properties must be an object"
    else
      @required_attributes.each do |key|
        value = properties[key]
        errors << "Required attribute '#{key}' is missing or blank" if value.nil? || (value.respond_to?(:empty?) && value.empty?) || (value.is_a?(String) && value.strip.empty?)
      end
    end
    geometry = feature["geometry"]
    return errors + ["Geometry must be an object"] unless geometry.is_a?(Hash)
    return errors + ["Unsupported geometry: use #{SUPPORTED.join(', ')}"] unless SUPPORTED.include?(geometry["type"])
    coordinates = geometry["coordinates"]
    case geometry["type"]
    when "Point"
      position(coordinates, errors)
    when "MultiPoint"
      collection(coordinates, errors, "MultiPoint", 1) { |value| position(value, errors) }
    when "LineString"
      line(coordinates, errors)
    when "MultiLineString"
      collection(coordinates, errors, "MultiLineString", 1) { |value| line(value, errors) }
    when "Polygon"
      polygon(coordinates, errors)
    when "MultiPolygon"
      collection(coordinates, errors, "MultiPolygon", 1) { |value| polygon(value, errors) }
    end
    errors.uniq
  end

  private

  def position(value, errors)
    unless value.is_a?(Array) && value.size == 2 && value.all? { |number| number.is_a?(Numeric) && number.finite? }
      errors << "Positions must contain exactly two finite numbers: longitude, latitude"
      return
    end
    errors << "Longitude must be between -180 and 180" unless value[0].between?(-180, 180)
    errors << "Latitude must be between -90 and 90" unless value[1].between?(-90, 90)
  end

  def collection(value, errors, label, minimum)
    unless value.is_a?(Array) && value.size >= minimum
      errors << "#{label} requires at least #{minimum} #{minimum == 1 ? 'member' : 'members'}"
      return
    end
    value.each { |member| yield member }
  end

  def line(value, errors)
    collection(value, errors, "LineString", 2) { |coordinate| position(coordinate, errors) }
  end

  def polygon(value, errors)
    collection(value, errors, "Polygon", 1) do |ring|
      collection(ring, errors, "Polygon ring", 4) { |coordinate| position(coordinate, errors) }
      errors << "Polygon rings must be closed: first and last position must match" if ring.is_a?(Array) && ring.first != ring.last
    end
  end
end
