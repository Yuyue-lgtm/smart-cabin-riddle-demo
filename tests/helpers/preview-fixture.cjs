function previewFixture(input) {
  return {route:'preview',game_id:input.game_id,round_id:input.round_id,scene_version:input.scene_version,
    event_id:input.event?.id,event_type:input.event?.type,preview_status:'ready',
    workflow_output:JSON.stringify({preview_status:'ready',round_question_plan:{plan_id:input.round_id,
      steps:['它是人造的吗？','它常在户外使用吗？','它有把手吗？','它可以折叠吗？'].map((text,index)=>({
        id:`fixture-${index}`,order:index+1,fact_key:`fixture-${index}`,depends_on:[],variants:{default:text}}))}})};
}
module.exports={previewFixture};
