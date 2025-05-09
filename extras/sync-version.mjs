import pkg from '@lenne.tech/npm-package-helper';
const NpmPackageHelper = pkg.default;
import { join } from 'path';

const dir = process.cwd();

NpmPackageHelper.setHighestVersion([
  NpmPackageHelper.getFileData(join(dir, 'package-lock.json')),
  NpmPackageHelper.getFileData(join(dir, 'package.json')),
]).then(console.log);
