require 'test_helper'

class InfrastructureInputAuditTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(name: 'Audit inspector', email: 'second-inspection-audit@example.test', role: 'staff', password: 'Learning123!')
    @asset = InfrastructureAsset.create!(asset_code: 'AUDIT-A', name: 'Audit tower', kind: 'tower', longitude: -105.28, latitude: 39.98, ground_elevation_m: 1600, structure_height_m: 30, corridor_order: 0)
    @second = InfrastructureAsset.create!(asset_code: 'AUDIT-B', name: 'Audit pole', kind: 'pole', longitude: -105.27, latitude: 39.98, ground_elevation_m: 1620, structure_height_m: 20, corridor_order: 1)
    @inspection = @asset.inspections.create!(author: @user, severity: 'high', notes: 'A synthetic fitting needs repair.', observed_at: Time.current)
    post '/api/session', params: {email: @user.email, password: 'Learning123!'}, as: :json
    assert_response :success
  end

  test 'malformed inspection objects return bad request without changing records' do
    ['invalid', 42, ['invalid']].each do |value|
      assert_no_difference 'Inspection.count' do
        post "/api/assets/#{@asset.id}/inspections", params: {inspection: value}, as: :json
        assert_response :bad_request
      end
      assert_no_difference 'InspectionEvent.count' do
        patch "/api/inspections/#{@inspection.id}", params: {inspection: value}, as: :json
        assert_response :bad_request
      end
    end
  end

  test 'invalid version values cannot bypass the optimistic locking input contract' do
    [0.5, 'garbage', '', true, 2_147_483_648, '9' * 100].each do |version|
      assert_no_difference 'InspectionEvent.count' do
        patch "/api/inspections/#{@inspection.id}", params: {inspection: {status: 'resolved', resolution_notes: 'The synthetic fitting was repaired.', lock_version: version}}, as: :json
        assert_response :bad_request
      end
      assert_equal 'open', @inspection.reload.status
    end
  end

  test 'ambiguous enqueue failure cannot discard a completed profile' do
    original = ProfileJob.method(:perform_later)
    ProfileJob.define_singleton_method(:perform_later) do |id, generation|
      perform_now(id, generation)
      raise IOError, 'Queue acknowledgement lost after delivery'
    end
    post '/api/profile_runs', as: :json
    assert_response :accepted
    run = ProfileRun.find(response.parsed_body.fetch('profile_run').fetch('id'))
    assert_equal 'completed', run.status
    assert_nil run.error_message
    get "/api/profile_runs/#{run.id}/download"
    assert_response :success
  ensure
    ProfileJob.define_singleton_method(:perform_later, original) if original
  end

  test 'unexpected profile failures do not expose internal connection details' do
    run = ProfileRun.create!(user: @user, asset_snapshot: [@asset.payload, @second.payload])
    original = CorridorProfile.method(:build)
    CorridorProfile.define_singleton_method(:build) { |*| raise 'postgres://private:password@internal' }
    ProfileJob.perform_now(run.id, run.generation)
    assert_equal 'failed', run.reload.status
    assert_match(/Retry/, run.error_message)
    assert_no_match(/postgres|private|password/, run.error_message)
  ensure
    CorridorProfile.define_singleton_method(:build, original) if original
  end
end
