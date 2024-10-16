#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as fs           from 'node:fs/promises';

/** 操作対象となる `package.json` ファイルのパス (本コマンド実行時のカレントディレクトリ直下) */
const packageJsonFilePath = './package.json';
/** 退避ファイルとなる `package.json.temp` ファイルのパス (本コマンド実行時のカレントディレクトリ直下) */
const tempPackageJsonFilePath = `${packageJsonFilePath}.temp`;

/** Cleanup のみ行うモードか否か */
const isCleanupOnlyMode = args => args.includes('--cleanup');

/** 引数から `XXXDependencies` の文言を収集してリスト化する */
const listTargetNames = args => args.filter(args => args.endsWith('Dependencies'));

/** `package.json.temp` を作成する */
const createTempPackageJson = async () => {
  await fs.copyFile(packageJsonFilePath, tempPackageJsonFilePath);
};

/** `package.json` を読み取る */
const readPackageJson = async () => {
  const packageJsonFile = await fs.readFile(packageJsonFilePath, 'utf-8');
  const packageJson = JSON.parse(packageJsonFile);
  if(packageJson.devDependencies != null) packageJson['__devDependencies'] = Object.assign({}, packageJson.devDependencies);  // `devDependencies` を書き換えるため一時ファイルには元の状態を退避しておく
  if(packageJson.devDependencies == null) packageJson.devDependencies = {};  // `devDependencies` そのものがない場合は空の連想配列を作っておく
  return packageJson;
};

/** 指定の `XXXDependencies` を `devDependencies` にマージ追加する */
const mergeTargets = (packageJson, targetName) => {
  if(packageJson[targetName] == null) throw new Error('The Target Name Does Not Exist');
  packageJson.devDependencies = Object.assign(packageJson.devDependencies, packageJson[targetName]);
};

/** `package.json` を書き出す */
const writePackageJson = async packageJson => {
  const packageJsonStringified = JSON.stringify(packageJson, null, '  ');
  await fs.writeFile(packageJsonFilePath, packageJsonStringified, 'utf-8');
};

/** `package.json.temp` を元の `package.json` に戻す */
const cleanupPackageJson = async () => {
  await fs.copyFile(tempPackageJsonFilePath, packageJsonFilePath);
  await fs.unlink(tempPackageJsonFilePath);
};

/** `npm install` を実行する */
const installPackages = async () => {
  const installProcess = childProcess.spawn('npm', ['install', '--include=dev', '--no-package-lock'], { pwd: '.', stdio: 'inherit', shell: true });
  // FIXME : Ctrl+C で強制終了した時に正しく Cleanup されない場合がある
  installProcess.on('close', async code => {
    await cleanupPackageJson().catch(_error => null);
    if(code === 1) return console.warn('\nCancelled');
    console.log('\nInstall Succeeded');
  });
  ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'uncaughtException'].forEach(eventType => {
    installProcess.on(eventType, async () => {
      installProcess.emit('error', { code: 1 });
    });
  });
};

/** Main */
(async () => {
  try {
    // Cleanup のみ行う場合
    if(isCleanupOnlyMode(process.argv.slice(-1))) {
      console.log('Neo\'s Handpick : Cleanup Mode');
      await cleanupPackageJson();
      return;
    }
    
    // 引数を読み取る
    const targetNames = listTargetNames(process.argv.slice(-1));
    
    // `package.json.temp` を退避作成しておく
    await createTempPackageJson();
    
    // `package.json` を用意する
    const packageJson = await readPackageJson();
    targetNames.forEach(targetName => {
      mergeTargets(packageJson, targetName);
    });
    await writePackageJson(packageJson);
    
    console.log('Neo\'s Handpick')
    console.log('  Install  : dependencies devDependencies');
    if(targetNames.length > 0) console.log(`  Includes : ${targetNames.join(' ')}`);
    
    // `npm install` を実行する・子プロセスの終了時に `package.json` を元に戻す
    await installPackages();
  }
  catch(error) {
    console.error('\nAn Error Has Occurred :');
    console.error(error);
  }
})();
