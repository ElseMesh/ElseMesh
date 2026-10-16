#!/usr/bin/env bash
set -euo pipefail

# Mirror the main Loz repository under loz/<branch>, and its preview
# repository under loz/preview/<branch>. Replaced and deleted tips are retained
# under archive/loz-preserved/<source-prefix>/<branch>/<old-sha>.

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
cd "$repo_root"

die() {
	printf 'mirror-loz: %s\n' "$*" >&2
	exit 1
}

preview_url='https://github.com/lozknowles/ElseMesh-preview.git'
git remote get-url loz >/dev/null 2>&1 || die "remote 'loz' is not configured"
git remote get-url origin >/dev/null 2>&1 || die "remote 'origin' is not configured"
if configured_preview_url=$(git remote get-url loz-preview 2>/dev/null); then
	[[ "$configured_preview_url" == "$preview_url" ]] || die "remote 'loz-preview' points to an unexpected URL"
else
	git remote add loz-preview "$preview_url"
fi

git fetch --prune loz || die "fetch from 'loz' failed"
git fetch --prune loz-preview || die "fetch from 'loz-preview' failed"
git fetch --prune origin || die "fetch from 'origin' failed"

declare -A main_source_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] && main_source_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=3)' refs/remotes/loz/)

declare -A preview_source_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] && preview_source_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=3)' refs/remotes/loz-preview/)

# Reserve loz/preview/* for the preview repository so target refs cannot clash.
for branch in "${!main_source_branches[@]}"; do
	if [[ "$branch" == preview || "$branch" == preview/* ]]; then
		die "main Loz branch '$branch' conflicts with the reserved loz/preview subtree"
	fi
done

declare -A main_active_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] || continue
	[[ "$branch" == preview || "$branch" == preview/* ]] && continue
	main_active_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=4)' refs/remotes/origin/loz/)

declare -A preview_active_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] && preview_active_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=5)' refs/remotes/origin/loz/preview/)

rename_refspecs=()
publish_refspecs=()
published=0
preserved=0
deleted=0
unchanged=0

preserve_ref() {
	local path=$1 sha=$2
	local destination="refs/heads/archive/loz-preserved/$path/$sha"
	local existing
	existing=$(git ls-remote --heads origin "$destination" | awk 'NR == 1 {print $1}')
	if [[ -n "$existing" && "$existing" != "$sha" ]]; then
		die "preservation ref collision at $destination"
	fi
	if [[ "$existing" != "$sha" ]]; then
		rename_refspecs+=("$sha:$destination")
		((preserved += 1))
	fi
}

sync_branch() {
	local remote=$1 target_prefix=$2 archive_prefix=$3 legacy_prefix=$4 branch=$5
	local target_branch="${target_prefix}${branch}"
	local archive_branch="${archive_prefix}${branch}"
	local source_sha active_ref remote_active_ref active_sha legacy_ref
	source_sha=$(git rev-parse "refs/remotes/$remote/$branch")
	active_ref="refs/heads/loz/$target_branch"
	remote_active_ref="refs/remotes/origin/loz/$target_branch"
	active_sha=''
	if git show-ref --verify --quiet "$remote_active_ref"; then
		active_sha=$(git rev-parse "$remote_active_ref")
	fi

	if [[ -z "$active_sha" ]]; then
		# Preserve the pre-mirror archive on first sync, then create the active
		# branch directly at the source commit.
		legacy_ref="refs/remotes/origin/archive/loz/${legacy_prefix}${branch}"
		if git show-ref --verify --quiet "$legacy_ref"; then
			preserve_ref "$archive_branch" "$(git rev-parse "$legacy_ref")"
		fi
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'publish %s at exact %s tip %s\n' "$target_branch" "$remote" "${source_sha:0:12}"
		((published += 1))
	elif [[ "$active_sha" == "$source_sha" ]]; then
		printf 'unchanged %s (%s)\n' "$target_branch" "${source_sha:0:12}"
		((unchanged += 1))
	elif git merge-base --is-ancestor "$active_sha" "$source_sha"; then
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'advance %s to exact source tip %s\n' "$target_branch" "${source_sha:0:12}"
		((published += 1))
	else
		preserve_ref "$archive_branch" "$active_sha"
		rename_refspecs+=(":$active_ref")
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'rewrite %s: preserve %s, then publish exact tip %s\n' \
			"$target_branch" "${active_sha:0:12}" "${source_sha:0:12}"
		((published += 1))
	fi
}

for branch in "${!main_source_branches[@]}"; do
	sync_branch loz '' '' '' "$branch"
done
for branch in "${!preview_source_branches[@]}"; do
	sync_branch loz-preview 'preview/' 'preview/' 'preview/' "$branch"
done

# Keep upstream deletions as preserved refs, removing only the active names.
for branch in "${!main_active_branches[@]}"; do
	if [[ -z "${main_source_branches[$branch]:-}" ]]; then
		active_sha=$(git rev-parse "refs/remotes/origin/loz/$branch")
		preserve_ref "$branch" "$active_sha"
		rename_refspecs+=(":refs/heads/loz/$branch")
		printf 'deleted %s; preserved %s\n' "$branch" "${active_sha:0:12}"
		((deleted += 1))
	fi
done
for branch in "${!preview_active_branches[@]}"; do
	if [[ -z "${preview_source_branches[$branch]:-}" ]]; then
		active_sha=$(git rev-parse "refs/remotes/origin/loz/preview/$branch")
		preserve_ref "preview/$branch" "$active_sha"
		rename_refspecs+=(":refs/heads/loz/preview/$branch")
		printf 'deleted preview/%s; preserved %s\n' "$branch" "${active_sha:0:12}"
		((deleted += 1))
	fi
done

# Preserve and remove refs atomically. If the next push is interrupted, rerun
# sees the missing active ref and recreates it directly from the source tip.
if ((${#rename_refspecs[@]})); then
	git push --atomic origin "${rename_refspecs[@]}" || die "preservation/rename push failed; remote refs were not changed"
fi
if ((${#publish_refspecs[@]})); then
	git push --atomic origin "${publish_refspecs[@]}" || die "publication failed; rerun to complete any pending mirror creation"
fi

printf 'mirror-loz: %d published, %d preserved, %d deleted, %d unchanged\n' \
	"$published" "$preserved" "$deleted" "$unchanged"
