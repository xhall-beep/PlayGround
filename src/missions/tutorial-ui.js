// Tutorial presentation layer: objective bar, coach card, completion banner.
// Pure DOM — reads mission state, never touches the sim.
import { MISSION1 } from '../missions/mission1.js';

export class TutorialUI{
  constructor(root){
    this.root=root;
    this.bar=root.querySelector('#tutbar');
    this.stepTitle=root.querySelector('#tut-step');
    this.stepSub=root.querySelector('#tut-sub');
    this.progressFill=root.querySelector('#tut-fill');
    this.counter=root.querySelector('#tut-counter');
    this.coach=root.querySelector('#tut-coach');
    this.coachText=root.querySelector('#tut-coach-text');
    this.skip=root.querySelector('#tut-skip');
    this.doneCard=root.querySelector('#tut-done');
    this.doneSub=root.querySelector('#tut-done-sub');
    this.doneContinue=root.querySelector('#tut-done-go');
    this.onSkip=null; this.onDone=null;
    this._coachFade=0;
    this.skip.onclick=()=>{ this.onSkip&&this.onSkip(); };
    this.doneContinue.onclick=()=>{ this.onDone&&this.onDone(); };
    this.visible=false;
  }
  show(){ this.visible=true; this.bar.style.display='block'; }
  hide(){ this.visible=false; clearTimeout(this._coachFade); this.bar.style.display='none'; this.coach.style.display='none'; this.coach.classList.remove('fade'); this.doneCard.style.display='none'; }
  /** Per-frame-ish update from mission runner + ctx. */
  update(runner,ctx){
    if(!this.visible) return;
    const total=runner.def.steps.length;
    const idx=Math.min(runner.step+1,total);
    this.counter.textContent=`MISSION 1 · ${MISSION1.name}  ·  STEP ${idx}/${total}`;
    if(runner.done){
      this.stepTitle.textContent='Mission complete';
      this.stepSub.textContent=`Reward: ${MISSION1.reward.gold}🪙 ${MISSION1.reward.wood}🪵 ${MISSION1.reward.achievement}`;
      this.progressFill.style.width='100%';
      this.coach.style.display='none';
      clearTimeout(this._coachFade); this.coach.classList.remove('fade');
      return;
    }
    const step=runner.current;
    this.stepTitle.textContent=step.title;
    this.stepSub.textContent=runner.progressText(ctx);
    this.progressFill.style.width=`${Math.round(runner.progress(ctx)*100)}%`;
    // Coach card: a short-lived bottom hint that never sits over the map centre.
    if(step.coach){
      this.coach.style.display='block';
      if(this.coachText.textContent!==step.coach){
        this.coachText.textContent=step.coach;
        this.coach.classList.remove('fade');
        clearTimeout(this._coachFade);
        this._coachFade=setTimeout(()=>this.coach.classList.add('fade'),5000);
      }
    } else { this.coach.style.display='none'; clearTimeout(this._coachFade); this.coach.classList.remove('fade'); }
  }
  celebrate(reward){
    this.doneSub.textContent=`+${reward.gold}🪙 +${reward.wood}🪵 ${reward.achievement} added to your kingdom.`;
    this.doneCard.style.display='flex';
  }
}
