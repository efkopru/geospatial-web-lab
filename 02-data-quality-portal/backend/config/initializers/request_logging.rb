# Keeps request logs small and free of uploaded data.
#
# Rails writes every parameter of a request to the log before any before_action runs, so a
# request with a large body filled the log with it, whether or not the sender was signed in, and
# uploads were copied into the log. A body larger than MAX_LOGGED_BODY_BYTES is now logged as
# its size, next to the request's query and path parameters. The two upload parameters are never
# logged, whatever their size.
Rails.application.config.filter_parameters += [/\Asource\z/, /\Ageojson\z/]

module BoundedParameterLogging
  MAX_LOGGED_BODY_BYTES = 10_000

  # What Rails logs as "Parameters:" and hands to error reports; the application reads params.
  def filtered_parameters
    return super if content_length <= MAX_LOGGED_BODY_BYTES
    @filtered_parameters ||= parameter_filter.filter(query_parameters.merge(path_parameters.stringify_keys))
      .merge("request body" => "[#{content_length} bytes not logged]")
  rescue ActionDispatch::Http::Parameters::ParseError
    @filtered_parameters = {}
  end
end

unless %i[filtered_parameters parameter_filter content_length query_parameters path_parameters].all? { |name| ActionDispatch::Request.method_defined?(name) }
  raise "ActionDispatch::Request changed; review config/initializers/request_logging.rb"
end
ActionDispatch::Request.prepend(BoundedParameterLogging)
