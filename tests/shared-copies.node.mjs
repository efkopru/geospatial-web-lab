// Several files are copied rather than shared so that each application stays an independent
// stack and the standalone folder stays a separate checkout. These copies must stay identical:
// a fix made in one copy has to be made in all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const apps = ['01-service-requests', '02-data-quality-portal', '03-fleet-monitor', '04-parcel-scenarios', '05-infrastructure-inspections'];
const backendCopies = [
  '.dockerignore', 'Dockerfile', 'Rakefile', 'bin/rails', 'config.ru',
  'app/channels/application_cable/channel.rb', 'app/channels/application_cable/connection.rb',
  'app/controllers/api/sessions_controller.rb', 'app/controllers/application_controller.rb',
  'app/jobs/application_job.rb', 'app/models/application_record.rb', 'app/models/login_session.rb', 'app/models/user.rb',
  'config/boot.rb', 'config/environment.rb', 'config/environments/development.rb',
  'config/environments/production.rb', 'config/environments/test.rb',
  'db/migrate/001_create_users.rb', 'db/migrate/010_create_login_sessions.rb',
  'test/authentication_test.rb', 'test/test_helper.rb'
];
const editionCopies = [
  ['shared/geometry.js', 'standalone/shared/geometry.js'],
  ['shared/map.jsx', 'standalone/shared/map.jsx'],
  ['01-service-requests/frontend/src/service.css', 'standalone/01-service-requests/src/service.css'],
  ['03-fleet-monitor/frontend/src/fleet.css', 'standalone/03-fleet-monitor/src/fleet.css'],
  ['05-infrastructure-inspections/frontend/src/CorridorViewer.jsx', 'standalone/05-infrastructure-inspections/src/CorridorViewer.jsx'],
  ['05-infrastructure-inspections/frontend/src/inspections.css', 'standalone/05-infrastructure-inspections/src/inspections.css']
];
// Windows checkouts may use CRLF in the working tree; the repository stores LF.
const read = path => readFileSync(root + path, 'utf8').replace(/\r\n/g, '\n');

for (const file of backendCopies) {
  test(`backend/${file} is identical in all five applications`, () => {
    const reference = read(`${apps[0]}/backend/${file}`);
    const different = apps.slice(1).filter(app => read(`${app}/backend/${file}`) !== reference);
    assert.deepEqual(different, [], `Differs from ${apps[0]}/backend/${file}; apply the change to every copy`);
  });
}

for (const [fullStack, standalone] of editionCopies) {
  test(`${standalone} matches ${fullStack}`, () => {
    assert.ok(read(standalone) === read(fullStack), `${standalone} differs from ${fullStack}; apply the change to both editions`);
  });
}
