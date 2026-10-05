import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, content) {
  fs.writeFileSync(path, content)
}

function replaceOnce(content, from, to, label) {
  if (content.includes(to)) return content
  if (!content.includes(from)) throw new Error(`Patch target not found: ${label}`)
  return content.replace(from, to)
}

function replaceAllExact(content, from, to, label) {
  if (content.includes(to) && !content.includes(from)) return content
  if (!content.includes(from)) throw new Error(`Patch target not found: ${label}`)
  return content.split(from).join(to)
}

// A-pose / arm-extension tools should be available to all humanoid presets.
{
  const path = 'src/Mesh2MotionEngine.ts'
  let s = read(path)
  s = replaceOnce(
    s,
    "import { SkeletonType } from './lib/enums/SkeletonType.ts'\n",
    "import { SkeletonType } from './lib/enums/SkeletonType.ts'\nimport { is_humanoid_skeleton_type } from './lib/HumanoidSkeleton.ts'\n",
    'Mesh2MotionEngine import'
  )
  s = replaceOnce(
    s,
    'this.load_skeleton_step.skeleton_type() === SkeletonType.Human',
    'is_humanoid_skeleton_type(this.load_skeleton_step.skeleton_type())',
    'Mesh2MotionEngine A-pose visibility'
  )
  write(path, s)
}

// Head and shoulder weight-correction UI is human-specific and must also apply
// to Mobile Female.
{
  const path = 'src/lib/processes/edit-skeleton/StepEditSkeleton.ts'
  let s = read(path)
  s = replaceOnce(
    s,
    "import { SkeletonType } from '../../enums/SkeletonType.ts'\n",
    "import { SkeletonType } from '../../enums/SkeletonType.ts'\nimport { is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'\n",
    'StepEditSkeleton import'
  )
  s = replaceAllExact(
    s,
    'skeleton_type === SkeletonType.Human',
    'is_humanoid_skeleton_type(skeleton_type)',
    'StepEditSkeleton humanoid checks'
  )
  write(path, s)
}

// Human naming/export presets should be available for Mobile Female too.
{
  const path = 'src/lib/processes/export-to-file/DownloadSettings.ts'
  let s = read(path)
  s = replaceOnce(
    s,
    "import { SkeletonType } from '../../enums/SkeletonType.ts'\n",
    "import { SkeletonType } from '../../enums/SkeletonType.ts'\nimport { is_humanoid_skeleton_type } from '../../HumanoidSkeleton.ts'\n",
    'DownloadSettings import'
  )
  s = replaceOnce(
    s,
    'const is_human_skeleton = skeleton_type === SkeletonType.Human',
    'const is_human_skeleton = is_humanoid_skeleton_type(skeleton_type)',
    'DownloadSettings humanoid export check'
  )
  write(path, s)
}

// Retarget preview must expose the same arm-extension correction for Mobile Female.
{
  const path = 'src/retarget/RetargetAnimationListing.ts'
  let s = read(path)
  s = replaceOnce(
    s,
    "import { SkeletonType } from '../lib/enums/SkeletonType.ts'\n",
    "import { SkeletonType } from '../lib/enums/SkeletonType.ts'\nimport { is_humanoid_skeleton_type } from '../lib/HumanoidSkeleton.ts'\n",
    'RetargetAnimationListing import'
  )
  s = replaceOnce(
    s,
    'AnimationRetargetService.getInstance().get_skeleton_type() === SkeletonType.Human',
    'is_humanoid_skeleton_type(AnimationRetargetService.getInstance().get_skeleton_type())',
    'RetargetAnimationListing humanoid check'
  )
  write(path, s)
}

// Props/weapons supported by Human should also be available to the Mobile Female rig.
{
  const path = 'src/lib/processes/animations-listing/props/PropCatalog.ts'
  let s = read(path)
  s = replaceOnce(
    s,
    'public static readonly supported_skeleton_types: SkeletonType[] = [SkeletonType.Human, SkeletonType.Kaiju]',
    'public static readonly supported_skeleton_types: SkeletonType[] = [SkeletonType.Human, SkeletonType.MobileFemale, SkeletonType.Kaiju]',
    'PropCatalog supported humanoid types'
  )
  write(path, s)
}

console.log('Mobile Female human-pipeline patches applied.')
