import simpleGit from 'simple-git';
import path from 'path';
import os from 'os';
import fs from 'fs';

// This adds an event handler that your code will call later. When this event handler is called, it will log the event to the console. 
// Then, it will use GitHub's REST API to sync the pushed commits that triggered the event in the shadow repo
export async function handlePush({ octokit, payload }, config, token) {
    try {
        // handle the event if the push is for a repository whose name matches the whitelist pattern in the config file but not the blacklist pattern
        if (config.settings.whitelist && !config.settings.whitelist.some((pattern) => new RegExp(pattern).test(payload.repository.name))) {
            console.log(`Push ignored because it's for a repository that does not match the whitelist pattern`);
            return;
        }
        if (config.settings.exceptions && config.settings.exceptions.some((pattern) => new RegExp(pattern).test(payload.repository.name))) {
            console.log(`Push ignored because it's for a repository that matches the blacklist pattern`);
            return;
        }

        console.log(`Received a push event for ${payload.commits.length} commit(s) in ${payload.repository.full_name}`);
        // await postComment(octokit, payload);
        await syncSourceOrgWithShadowOrgs(payload, config, token);
    } catch (error) {
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
        }
        console.error(error)
    }
};

async function syncSourceOrgWithShadowOrgs(payload, config, token) {
    for (const targetOrg of config.settings.shadows) {
        const shadowRepo = `${targetOrg}/${payload.repository.name}`;
        try {
            const repoDir = await createTempSubfolder(payload.repository.owner.login, payload.repository.name);
            const git = await initializeGitRepo(repoDir, payload.repository.owner.login, payload.repository.name, token);
            await fetchAndPullSourceRepo(git);
            await pushToShadowRepos(git, shadowRepo, token);

            console.log(`Synchronized with ${shadowRepo}`);
        } catch (error) {
            console.error(`Error pushing commits to ${shadowRepo}`);
            console.error(error);
        }
    }
}

// Creates a subfolder in the temp directory of owner-name/repo-name if it doesn't exist
async function createTempSubfolder(owner, repo) {
    const tempDir = path.join(os.tmpdir(), owner, repo);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

// Initialize the subfolder as a git repository using simple-git, and authenticate with the installationOctokit
async function initializeGitRepo(directory, owner, repo, token) {
    const git = simpleGit(directory);
    try {
        await git.init();
        console.log(`Initialized git repository in ${directory}`);

        const remoteUrl = `https://${token}@github.com/${owner}/${repo}.git`;
        const remoteUrlMasked = `https://ghp_xxxx@github.com/${owner}/${repo}.git`;
        const isRemoteExist = await git.getRemotes(false).then(remotes => remotes.some(remote => remote.name === 'origin'));
        if (isRemoteExist) {
            await git.removeRemote('origin');
        }
        await git.addRemote('origin', remoteUrl);

        console.log(`Added remote origin ${remoteUrlMasked}`);

        return git;
    } catch (error) {
        console.error(`Error initializing git repository in ${directory}`);
        console.error(error);
    }
}

// Fetch and pull everything from the source repository
async function fetchAndPullSourceRepo(git) {
    try {
        // Prune before fetching
        await git.remote(['prune', 'origin']);
        console.log(`Pruned origin`);

        await git.fetch('origin');
        console.log(`Fetched everything from origin`);

        // Pull all branches from the origin
        const branches = await git.branch(['-r']); // Get remote branches
        for (const branch of branches.all) {
            if (branch.startsWith('origin/')) { // Only consider branches from origin
                const branchName = branch.replace('origin/', ''); // Remove 'origin/' prefix
                try {
                    await git.checkout(branchName);
                    await git.pull('origin', branchName, { '--rebase': 'true' }); // Use rebase during pull
                    console.log(`Pulled ${branchName} from origin`);
                } catch (error) {
                    console.error(`Error pulling ${branchName} from origin`);
                    console.error(error);
                }
            }
        }
        console.log(`Pulled everything from origin`);
    } catch (error) {
        console.error(`Error fetching everything from origin`);
        console.error(error);
    }
}

// Pushes the git repo to all shadow repos
async function pushToShadowRepos(git, shadowRepo, token) {
    try {
        // add a remote to the shadow repo called 'target'
        const shadowUrl = `https://${token}@github.com/${shadowRepo}.git`;
        const shadowUrlMasked = `https://ghp_xxxx@github.com/${shadowRepo}.git`;
        const isShadowRemoteExist = await git.getRemotes(false).then(remotes => remotes.some(remote => remote.name === 'target'));
        if (isShadowRemoteExist) {
            await git.removeRemote('target');
        }
        await git.addRemote('target', shadowUrl);
        console.log(`Added remote target ${shadowUrlMasked}`);

        // push all branches to the shadow repo
        await git.push('target', '--all');
        console.log(`Pushed to ${shadowRepo}`);
    } catch (error) {
        console.error(`Error pushing to ${shadowRepo}`);
        console.error(error);
    }
}