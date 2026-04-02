import { execSync } from 'child_process';

function run(command: string) {
  console.log(`$ ${command}`);
  execSync(command, {
    stdio: 'inherit',
  });
}

function main() {
  run('npm run wave8:safeguarding:demo:seed');
  run('npm run wave8:treasury:demo:seed');
  run('npm run wave8:gov02:demo:seed');
}

main();
