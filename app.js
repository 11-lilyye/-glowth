(function () {
  'use strict';

  const STORAGE_COURSES = 'growth_courses';
  const STORAGE_CLIMBS = 'growth_climbs';
  const STORAGE_PLANS = 'growth_plans';
  const IDB_NAME = 'growth_videos';
  const IDB_STORE = 'videos';
  const VIDEO_MAX_SIZE = 50 * 1024 * 1024; // 50MB

  function getCourses() {
    try {
      const raw = localStorage.getItem(STORAGE_COURSES);
      const data = raw ? JSON.parse(raw) : [];
      return data.map(function (c) {
        if (!c.items || !Array.isArray(c.items)) {
          return {
            id: c.id || 'c_' + Date.now(),
            name: c.name || '未命名',
            schedule: c.schedule || '',
            total: c.total != null ? c.total : null,
            items: []
          };
        }
        if (c.total === undefined && c.total !== 0) c.total = null;
        return c;
      });
    } catch {
      return [];
    }
  }

  function setCourses(data) {
    localStorage.setItem(STORAGE_COURSES, JSON.stringify(data));
  }

  function getClimbs() {
    try {
      const raw = localStorage.getItem(STORAGE_CLIMBS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function setClimbs(data) {
    localStorage.setItem(STORAGE_CLIMBS, JSON.stringify(data));
  }

  function getPlans() {
    try {
      const raw = localStorage.getItem(STORAGE_PLANS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function setPlans(data) {
    localStorage.setItem(STORAGE_PLANS, JSON.stringify(data));
  }

  /* ---------- IndexedDB for video ---------- */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onerror = function () { reject(r.error); };
      r.onsuccess = function () { resolve(r.result); };
      r.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
    });
  }

  function saveVideoToIDB(id, blob) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ id: id, blob: blob });
        tx.oncomplete = function () { resolve(); db.close(); };
        tx.onerror = function () { reject(tx.error); db.close(); };
      });
    });
  }

  function getVideoFromIDB(id) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(id);
        req.onsuccess = function () {
          db.close();
          resolve(req.result ? req.result.blob : null);
        };
        req.onerror = function () { reject(req.error); db.close(); };
      });
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeCsv(str) {
    if (str == null) return '';
    var s = String(str);
    if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const target = this.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      this.classList.add('active');
      var panel = document.getElementById(target);
      if (panel) panel.classList.add('active');
      if (target === 'courses') { renderCourseCharts(); renderCourseCards(); }
      if (target === 'climbing') { renderClimbCharts(); renderClimbList(); renderPlanList(); }
      if (target === 'tables') renderTable();
    });
  });

  /* ---------- Course form ---------- */
  const courseFormWrap = document.getElementById('courseFormWrap');
  const courseForm = document.getElementById('courseForm');
  const addCourseBtn = document.getElementById('addCourseBtn');
  const cancelCourseBtn = document.getElementById('cancelCourseBtn');

  addCourseBtn.addEventListener('click', function () {
    document.getElementById('courseId').value = '';
    document.getElementById('courseName').value = '';
    document.getElementById('courseSchedule').value = '';
    document.getElementById('courseTotal').value = '';
    courseFormWrap.hidden = false;
  });

  cancelCourseBtn.addEventListener('click', function () {
    courseFormWrap.hidden = true;
  });

  courseForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const id = document.getElementById('courseId').value;
    const name = document.getElementById('courseName').value.trim();
    const schedule = document.getElementById('courseSchedule').value.trim();
    const totalRaw = document.getElementById('courseTotal').value.trim();
    const total = totalRaw ? Math.max(1, parseInt(totalRaw, 10) || null) : null;
    const courses = getCourses();
    if (id) {
      const idx = courses.findIndex(function (c) { return c.id === id; });
      if (idx >= 0) {
        courses[idx].name = name;
        courses[idx].schedule = schedule;
        courses[idx].total = total;
      }
    } else {
      courses.push({
        id: 'c_' + Date.now(),
        name: name,
        schedule: schedule,
        total: total,
        items: []
      });
    }
    setCourses(courses);
    courseFormWrap.hidden = true;
    renderCourseCharts();
    renderCourseCards();
  });

  function editCourse(id) {
    const courses = getCourses();
    const c = courses.find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('courseId').value = c.id;
    document.getElementById('courseName').value = c.name;
    document.getElementById('courseSchedule').value = c.schedule || '';
    document.getElementById('courseTotal').value = c.total != null && c.total > 0 ? String(c.total) : '';
    courseFormWrap.hidden = false;
  }

  function deleteCourse(id) {
    if (!confirm('确定删除该课程吗？其下所有作业/视频/练习记录也会删除。')) return;
    setCourses(getCourses().filter(function (c) { return c.id !== id; }));
    renderCourseCharts();
    renderCourseCards();
  }

  /* ---------- Course items (作业/视频/练习) ---------- */
  const courseItemModal = document.getElementById('courseItemModal');
  const courseItemForm = document.getElementById('courseItemForm');
  const courseItemCancelBtn = document.getElementById('courseItemCancelBtn');

  function closeCourseItemModal() {
    courseItemModal.setAttribute('hidden', '');
    courseItemModal.setAttribute('aria-hidden', 'true');
  }

  function openCourseItemModal(courseId, itemId) {
    document.getElementById('courseItemCourseId').value = courseId;
    document.getElementById('courseItemId').value = itemId || '';
    if (itemId) {
      const courses = getCourses();
      const course = courses.find(function (c) { return c.id === courseId; });
      const item = course && course.items ? course.items.find(function (i) { return i.id === itemId; }) : null;
      if (item) {
        document.getElementById('courseItemModalTitle').textContent = '编辑项目';
        document.getElementById('courseItemUnit').value = item.unit || '';
        document.getElementById('courseItemType').value = item.type || '作业';
        document.getElementById('courseItemTitle').value = item.title || '';
        document.getElementById('courseItemDeadline').value = item.deadline || '';
        document.getElementById('courseItemCompleted').checked = !!item.completed;
        document.getElementById('courseItemGithub').checked = !!item.githubUploaded;
      }
    } else {
      document.getElementById('courseItemModalTitle').textContent = '添加 作业/视频/练习';
      document.getElementById('courseItemUnit').value = '';
      document.getElementById('courseItemType').value = '作业';
      document.getElementById('courseItemTitle').value = '';
      document.getElementById('courseItemDeadline').value = '';
      document.getElementById('courseItemCompleted').checked = false;
      document.getElementById('courseItemGithub').checked = false;
    }
    courseItemModal.removeAttribute('hidden');
    courseItemModal.setAttribute('aria-hidden', 'false');
  }

  courseItemCancelBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeCourseItemModal();
  });

  var courseItemModalCloseBtn = document.getElementById('courseItemModalClose');
  if (courseItemModalCloseBtn) {
    courseItemModalCloseBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCourseItemModal();
    });
  }

  courseItemModal.addEventListener('click', function (e) {
    if (e.target === courseItemModal) closeCourseItemModal();
  });

  courseItemForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const courseId = document.getElementById('courseItemCourseId').value;
    const itemId = document.getElementById('courseItemId').value;
    const unit = document.getElementById('courseItemUnit').value.trim() || '';
    const type = document.getElementById('courseItemType').value;
    const title = document.getElementById('courseItemTitle').value.trim();
    const deadline = document.getElementById('courseItemDeadline').value.trim() || '';
    const completed = document.getElementById('courseItemCompleted').checked;
    const githubUploaded = document.getElementById('courseItemGithub').checked;
    const courses = getCourses();
    const course = courses.find(function (c) { return c.id === courseId; });
    if (!course) { closeCourseItemModal(); return; }
    if (!course.items) course.items = [];
    if (itemId) {
      const idx = course.items.findIndex(function (i) { return i.id === itemId; });
      if (idx >= 0) {
        course.items[idx] = { id: itemId, unit: unit, type: type, title: title, deadline: deadline, completed: completed, githubUploaded: githubUploaded };
      }
    } else {
      course.items.push({
        id: 'i_' + Date.now(),
        unit: unit,
        type: type,
        title: title,
        deadline: deadline,
        completed: completed,
        githubUploaded: githubUploaded
      });
    }
    setCourses(courses);
    closeCourseItemModal();
    renderCourseCharts();
    renderCourseCards();
  });

  function editCourseItem(courseId, itemId) {
    openCourseItemModal(courseId, itemId);
  }

  function deleteCourseItem(courseId, itemId) {
    if (!confirm('确定删除这条记录吗？')) return;
    const courses = getCourses();
    const course = courses.find(function (c) { return c.id === courseId; });
    if (course && course.items) {
      course.items = course.items.filter(function (i) { return i.id !== itemId; });
      setCourses(courses);
      renderCourseCharts();
      renderCourseCards();
    }
  }

  function getCourseProgress(course) {
    const items = course.items || [];
    const done = items.filter(function (i) { return i.completed; }).length;
    var total = course.total;
    if (total != null && total > 0) {
      return Math.min(100, Math.round((done / total) * 100));
    }
    if (items.length === 0) return 0;
    return Math.round((done / items.length) * 100);
  }

  function renderCourseCards() {
    const container = document.getElementById('courseCards');
    const courses = getCourses();
    if (courses.length === 0) {
      container.innerHTML = '<div class="card empty-state"><p>暂无课程，点击「添加课程」开始（如 CS50x、CS50p），再为每门课添加作业/视频/练习完成情况。</p></div>';
      return;
    }
    container.innerHTML = courses.map(function (c) {
      const progress = getCourseProgress(c);
      const items = c.items || [];
      const done = items.filter(function (i) { return i.completed; }).length;
      const total = c.total != null && c.total > 0 ? c.total : items.length;
      const progressLabel = (c.total != null && c.total > 0) ? (done + '/' + total + ' · ' + progress + '%') : (progress + '%');
      var sortedItems = items.slice().sort(function (a, b) {
        var ua = (a.unit || '').toString();
        var ub = (b.unit || '').toString();
        if (ua !== ub) return ua.localeCompare(ub, 'zh');
        return (a.type || '').localeCompare(b.type || '', 'zh');
      });
      const rows = sortedItems.map(function (i) {
        return (
          '<tr>' +
            '<td>' + (i.unit ? escapeHtml(i.unit) : '—') + '</td>' +
            '<td><span class="badge badge-' + escapeHtml(i.type) + '">' + escapeHtml(i.type) + '</span></td>' +
            '<td>' + escapeHtml(i.title) + '</td>' +
            '<td>' + (i.deadline ? escapeHtml(i.deadline) : '—') + '</td>' +
            '<td class="' + (i.completed ? 'cell-done' : 'cell-no') + '">' + (i.completed ? '已完成' : '未完成') + '</td>' +
            '<td class="' + (i.githubUploaded ? 'cell-done' : 'cell-no') + '">' + (i.githubUploaded ? '是' : '否') + '</td>' +
            '<td class="item-actions">' +
              '<button type="button" onclick="window.editCourseItem(\'' + c.id + '\',\'' + i.id + '\')">编辑</button>' +
              '<button type="button" class="danger" onclick="window.deleteCourseItem(\'' + c.id + '\',\'' + i.id + '\')">删</button>' +
            '</td>' +
          '</tr>'
        );
      }).join('');
      return (
        '<div class="course-card" data-course-id="' + escapeHtml(c.id) + '">' +
          '<div class="course-card-header">' +
            '<div><span class="course-card-name">' + escapeHtml(c.name) + '</span> <span class="text-muted">' + escapeHtml(progressLabel) + '</span></div>' +
            '<div class="course-card-actions">' +
              '<button type="button" class="btn btn-secondary btn-sm" onclick="window.editCourse(\'' + c.id + '\')">编辑课程</button>' +
              '<button type="button" class="btn btn-ghost btn-sm danger" onclick="window.deleteCourse(\'' + c.id + '\')">删除</button>' +
            '</div>' +
          '</div>' +
          (c.schedule ? '<div class="course-schedule">' + escapeHtml(c.schedule) + '</div>' : '') +
          '<table class="course-items-table">' +
            '<thead><tr><th>项目/周</th><th>类型</th><th>名称</th><th>日期时限</th><th>完成</th><th>已上传 GitHub</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
          '<div class="add-item-row">' +
            '<button type="button" class="btn btn-secondary btn-sm" onclick="window.openCourseItemModal(\'' + c.id + '\')">+ 添加 作业/视频/练习</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  let courseBarChart = null;
  let courseDonutChart = null;

  function renderCourseCharts() {
    const courses = getCourses();
    const labels = courses.map(function (c) { return c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name; });
    const values = courses.map(function (c) { return getCourseProgress(c); });

    const barCtx = document.getElementById('courseBarChart');
    if (courseBarChart) courseBarChart.destroy();
    if (barCtx && courses.length > 0) {
      courseBarChart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: '完成度 %',
            data: values,
            backgroundColor: 'rgba(63, 185, 80, 0.7)',
            borderColor: '#3fb950',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 100, grid: { color: 'rgba(48,54,61,0.8)' }, ticks: { color: '#8b949e' } },
            x: { grid: { display: false }, ticks: { color: '#8b949e', maxRotation: 25 } }
          }
        }
      });
    }

    const donutCtx = document.getElementById('courseDonutChart');
    if (courseDonutChart) courseDonutChart.destroy();
    if (donutCtx && courses.length > 0) {
      const totalP = values.reduce(function (a, b) { return a + b; }, 0);
      const avg = values.length ? Math.round(totalP / values.length) : 0;
      courseDonutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['已完成', '未完成'],
          datasets: [{
            data: [avg, 100 - avg],
            backgroundColor: ['#3fb950', 'rgba(48,54,61,0.9)'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: { position: 'bottom', labels: { color: '#8b949e' } },
            tooltip: { callbacks: { label: function (ctx) { return ctx.label + ': ' + ctx.raw + '%'; } } }
          }
        },
        plugins: [{
          id: 'centerText',
          afterDraw: function (chart) {
            var ctx = chart.ctx;
            var width = chart.width;
            var height = chart.height;
            ctx.restore();
            ctx.font = 'bold 24px "Noto Sans SC"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#e6edf3';
            ctx.fillText(avg + '%', width / 2, height / 2 - 8);
            ctx.font = '12px "Noto Sans SC"';
            ctx.fillStyle = '#8b949e';
            ctx.fillText('平均完成度', width / 2, height / 2 + 14);
          }
        }]
      });
    }
  }

  /* ---------- Climb form: record type toggle ---------- */
  const climbRecordType = document.getElementById('climbRecordType');
  const climbGradeRow = document.getElementById('climbGradeRow');
  const climbResultRow = document.getElementById('climbResultRow');
  const climbTrainingRow = document.getElementById('climbTrainingRow');
  const climbDurationRow = document.getElementById('climbDurationRow');

  function toggleClimbFormByType() {
    const isTraining = climbRecordType.value === '训练';
    climbGradeRow.hidden = isTraining;
    climbResultRow.hidden = isTraining;
    climbTrainingRow.hidden = !isTraining;
    climbDurationRow.hidden = !isTraining;
  }

  climbRecordType.addEventListener('change', toggleClimbFormByType);

  /* ---------- Climb form ---------- */
  const climbFormWrap = document.getElementById('climbFormWrap');
  const climbForm = document.getElementById('climbForm');
  const addClimbBtn = document.getElementById('addClimbBtn');
  const cancelClimbBtn = document.getElementById('cancelClimbBtn');
  const climbVideoFile = document.getElementById('climbVideoFile');

  document.getElementById('climbDate').value = new Date().toISOString().slice(0, 10);

  addClimbBtn.addEventListener('click', function () {
    document.getElementById('climbId').value = '';
    document.getElementById('climbDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('climbRecordType').value = '攀岩';
    document.getElementById('climbGrade').value = 'V2';
    document.getElementById('climbResult').value = '完成';
    document.getElementById('climbNotes').value = '';
    document.getElementById('climbVideoUrl').value = '';
    document.getElementById('climbTrainingContent').value = '';
    document.getElementById('climbDuration').value = '';
    climbVideoFile.value = '';
    document.getElementById('climbVideoHint').textContent = '已上传的视频仅保存在本浏览器，大小建议 < 50MB';
    toggleClimbFormByType();
    climbFormWrap.hidden = false;
  });

  cancelClimbBtn.addEventListener('click', function () {
    climbFormWrap.hidden = true;
  });

  climbForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const id = document.getElementById('climbId').value;
    const date = document.getElementById('climbDate').value;
    const recordType = document.getElementById('climbRecordType').value;
    const grade = document.getElementById('climbGrade').value;
    const result = document.getElementById('climbResult').value;
    const notes = document.getElementById('climbNotes').value.trim();
    const videoUrl = document.getElementById('climbVideoUrl').value.trim();
    const trainingContent = document.getElementById('climbTrainingContent').value.trim();
    const duration = document.getElementById('climbDuration').value.trim();
    const file = climbVideoFile.files[0];
    const climbs = getClimbs();
    const newId = id || 'cl_' + Date.now();

    function doSave(videoFileId) {
      const payload = {
        id: newId,
        date: date,
        recordType: recordType,
        grade: recordType === '攀岩' ? grade : '',
        result: recordType === '攀岩' ? result : '',
        notes: notes,
        videoUrl: videoUrl || '',
        videoFileId: videoFileId || '',
        trainingContent: recordType === '训练' ? trainingContent : '',
        duration: recordType === '训练' ? duration : ''
      };
      if (id) {
        const idx = climbs.findIndex(function (c) { return c.id === id; });
        if (idx >= 0) climbs[idx] = payload;
      } else {
        climbs.push(payload);
      }
      setClimbs(climbs);
      climbFormWrap.hidden = true;
      renderClimbCharts();
      renderClimbList();
    }

    if (file) {
      if (file.size > VIDEO_MAX_SIZE) {
        document.getElementById('climbVideoHint').textContent = '视频文件请小于 50MB';
        return;
      }
      saveVideoToIDB(newId, file).then(function () {
        doSave(newId);
      }).catch(function () {
        document.getElementById('climbVideoHint').textContent = '视频保存失败，请重试或使用链接';
      });
    } else {
      doSave('');
    }
  });

  function editClimb(id) {
    const climbs = getClimbs();
    const c = climbs.find(function (x) { return x.id === id; });
    if (!c) return;
    document.getElementById('climbId').value = c.id;
    document.getElementById('climbDate').value = c.date;
    document.getElementById('climbRecordType').value = c.recordType || '攀岩';
    document.getElementById('climbGrade').value = c.grade || 'V2';
    document.getElementById('climbResult').value = c.result || '完成';
    document.getElementById('climbNotes').value = c.notes || '';
    document.getElementById('climbVideoUrl').value = c.videoUrl || '';
    document.getElementById('climbTrainingContent').value = c.trainingContent || '';
    document.getElementById('climbDuration').value = c.duration || '';
    climbVideoFile.value = '';
    document.getElementById('climbVideoHint').textContent = c.videoFileId ? '已有本地视频，重新选择可覆盖' : '已上传的视频仅保存在本浏览器，大小建议 < 50MB';
    toggleClimbFormByType();
    climbFormWrap.hidden = false;
  }

  function deleteClimb(id) {
    if (!confirm('确定删除这条记录吗？')) return;
    setClimbs(getClimbs().filter(function (c) { return c.id !== id; }));
    renderClimbCharts();
    renderClimbList();
  }

  function playClimbVideo(recordId) {
    const record = getClimbs().find(function (c) { return c.id === recordId; });
    if (!record) return;
    if (record.videoUrl) {
      window.open(record.videoUrl, '_blank');
      return;
    }
    if (record.videoFileId) {
      getVideoFromIDB(record.videoFileId).then(function (blob) {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const w = window.open('', '_blank');
          if (w) w.document.write('<html><head><title>视频</title></head><body style="margin:0;background:#000"><video src="' + url + '" controls style="width:100%;height:100vh"></video></body></html>');
          if (w) w.document.close();
        }
      });
    }
  }

  function renderClimbList() {
    const list = document.getElementById('climbList');
    const climbs = getClimbs().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (climbs.length === 0) {
      list.innerHTML = '<li class="empty-state"><p>暂无记录，点击「添加记录」开始</p></li>';
      return;
    }
    list.innerHTML = climbs.map(function (c) {
      const typeLabel = (c.recordType === '训练') ? '训练' : '攀岩';
      const desc = c.recordType === '攀岩'
        ? (c.grade + ' · ' + (c.result || ''))
        : (c.trainingContent || '') + (c.duration ? ' · ' + c.duration : '');
      const hasVideo = c.videoUrl || c.videoFileId;
      const videoBtn = hasVideo
        ? '<button type="button" class="btn btn-secondary btn-sm" onclick="window.playClimbVideo(\'' + c.id + '\')">播放视频</button>'
        : '';
      return (
        '<li>' +
          '<div>' +
            '<span class="record-type">' + escapeHtml(typeLabel) + '</span> ' +
            '<strong>' + escapeHtml(c.date) + '</strong> ' + escapeHtml(desc) +
            (c.notes ? ' <span class="text-muted">' + escapeHtml(c.notes) + '</span>' : '') +
            ' ' + videoBtn +
          '</div>' +
          '<div class="item-actions">' +
            '<button type="button" onclick="window.editClimb(\'' + c.id + '\')">编辑</button>' +
            '<button type="button" class="danger" onclick="window.deleteClimb(\'' + c.id + '\')">删除</button>' +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  /* ---------- Plans ---------- */
  const addPlanBtn = document.getElementById('addPlanBtn');
  const planFormWrap = document.getElementById('planFormWrap');
  const planForm = document.getElementById('planForm');
  const cancelPlanBtn = document.getElementById('cancelPlanBtn');

  addPlanBtn.addEventListener('click', function () {
    document.getElementById('planId').value = '';
    document.getElementById('planDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('planType').value = '攀岩';
    document.getElementById('planContent').value = '';
    planFormWrap.hidden = false;
  });

  cancelPlanBtn.addEventListener('click', function () {
    planFormWrap.hidden = true;
  });

  planForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const id = document.getElementById('planId').value;
    const date = document.getElementById('planDate').value;
    const type = document.getElementById('planType').value;
    const content = document.getElementById('planContent').value.trim();
    const plans = getPlans();
    if (id) {
      const idx = plans.findIndex(function (p) { return p.id === id; });
      if (idx >= 0) plans[idx] = { id: id, date: date, type: type, content: content };
    } else {
      plans.push({ id: 'p_' + Date.now(), date: date, type: type, content: content });
    }
    setPlans(plans);
    planFormWrap.hidden = true;
    renderPlanList();
  });

  function editPlan(planId) {
    const plans = getPlans();
    const p = plans.find(function (x) { return x.id === planId; });
    if (!p) return;
    document.getElementById('planId').value = p.id;
    document.getElementById('planDate').value = p.date;
    document.getElementById('planType').value = p.type || '攀岩';
    document.getElementById('planContent').value = p.content || '';
    planFormWrap.hidden = false;
  }

  function deletePlan(planId) {
    if (!confirm('确定删除该计划吗？')) return;
    setPlans(getPlans().filter(function (p) { return p.id !== planId; }));
    renderPlanList();
  }

  function renderPlanList() {
    const list = document.getElementById('planList');
    const plans = getPlans().slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (plans.length === 0) {
      list.innerHTML = '<li class="empty-state"><p>暂无安排，点击「添加计划」</p></li>';
      return;
    }
    list.innerHTML = plans.map(function (p) {
      return (
        '<li>' +
          '<span><strong>' + escapeHtml(p.date) + '</strong> ' + escapeHtml(p.type || '攀岩') + ' · ' + escapeHtml(p.content || '') + '</span>' +
          '<div class="item-actions">' +
            '<button type="button" onclick="window.editPlan(\'' + p.id + '\')">编辑</button>' +
            '<button type="button" class="danger" onclick="window.deletePlan(\'' + p.id + '\')">删</button>' +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  let climbGradeChart = null;
  let climbTrendChart = null;

  function renderClimbCharts() {
    const climbs = getClimbs().filter(function (c) { return (c.recordType || '攀岩') === '攀岩' && c.grade; });
    const gradeOrder = ['V0','V1','V2','V3','V4','V5','V6','V7','5.9','5.10','5.11','5.12'];
    const byGrade = {};
    gradeOrder.forEach(function (g) { byGrade[g] = 0; });
    climbs.forEach(function (c) {
      if (byGrade[c.grade] !== undefined) byGrade[c.grade]++;
    });
    const gradeLabels = Object.keys(byGrade).filter(function (g) { return byGrade[g] > 0; });
    if (gradeLabels.length === 0) gradeLabels.push('V0');

    const gradeCtx = document.getElementById('climbGradeChart');
    if (climbGradeChart) climbGradeChart.destroy();
    if (gradeCtx) {
      climbGradeChart = new Chart(gradeCtx, {
        type: 'bar',
        data: {
          labels: gradeLabels,
          datasets: [{
            label: '次数',
            data: gradeLabels.map(function (g) { return byGrade[g]; }),
            backgroundColor: 'rgba(210, 153, 34, 0.7)',
            borderColor: '#d29922',
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(48,54,61,0.8)' }, ticks: { color: '#8b949e' } },
            x: { grid: { display: false }, ticks: { color: '#8b949e' } }
          }
        }
      });
    }

    const allByDate = {};
    getClimbs().forEach(function (c) {
      allByDate[c.date] = (allByDate[c.date] || 0) + 1;
    });
    const trendLabels = Object.keys(allByDate).sort().slice(-14);
    const trendData = trendLabels.map(function (d) { return allByDate[d]; });

    const trendCtx = document.getElementById('climbTrendChart');
    if (climbTrendChart) climbTrendChart.destroy();
    if (trendCtx) {
      climbTrendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: trendLabels,
          datasets: [{
            label: '当日次数',
            data: trendData,
            borderColor: '#3fb950',
            backgroundColor: 'rgba(63, 185, 80, 0.1)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(48,54,61,0.8)' }, ticks: { color: '#8b949e' } },
            x: { grid: { display: false }, ticks: { color: '#8b949e', maxRotation: 45 } }
          }
        }
      });
    }
  }

  /* ---------- Table & Export ---------- */
  const tableSource = document.getElementById('tableSource');
  const tableHead = document.getElementById('tableHead');
  const tableBody = document.getElementById('tableBody');
  const tableHint = document.getElementById('tableHint');

  function renderTable() {
    const source = tableSource.value;
    if (source === 'courses') {
      const courses = getCourses();
      tableHead.innerHTML = '<tr><th>课程</th><th>项目/周</th><th>类型</th><th>名称</th><th>日期时限</th><th>完成</th><th>已上传 GitHub</th></tr>';
      const rows = [];
      courses.forEach(function (c) {
        (c.items || []).forEach(function (i) {
          rows.push([
            escapeHtml(c.name),
            i.unit ? escapeHtml(i.unit) : '—',
            i.type,
            escapeHtml(i.title),
            i.deadline ? escapeHtml(i.deadline) : '—',
            i.completed ? '是' : '否',
            i.githubUploaded ? '是' : '否'
          ]);
        });
        if ((c.items || []).length === 0)
          rows.push([escapeHtml(c.name), '—', '—', '—', '—', '—', '—']);
      });
      if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无课程数据</td></tr>';
      } else {
        tableBody.innerHTML = rows.map(function (r) {
          return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td>' + r[5] + '</td><td>' + r[6] + '</td></tr>';
        }).join('');
      }
      tableHint.textContent = '共 ' + courses.length + ' 门课程，可导出 CSV。';
    } else if (source === 'plans') {
      const plans = getPlans().slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      tableHead.innerHTML = '<tr><th>日期</th><th>类型</th><th>内容</th></tr>';
      if (plans.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="empty-state">暂无安排</td></tr>';
      } else {
        tableBody.innerHTML = plans.map(function (p) {
          return '<tr><td>' + escapeHtml(p.date) + '</td><td>' + escapeHtml(p.type || '攀岩') + '</td><td>' + escapeHtml(p.content || '') + '</td></tr>';
        }).join('');
      }
      tableHint.textContent = '共 ' + plans.length + ' 条安排，可导出 CSV。';
    } else {
      const climbs = getClimbs().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
      tableHead.innerHTML = '<tr><th>日期</th><th>类型</th><th>难度/内容</th><th>结果/时长</th><th>备注</th><th>视频</th></tr>';
      if (climbs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无记录</td></tr>';
      } else {
        tableBody.innerHTML = climbs.map(function (c) {
          const type = c.recordType || '攀岩';
          const col3 = type === '攀岩' ? (c.grade || '') : (c.trainingContent || '');
          const col4 = type === '攀岩' ? (c.result || '') : (c.duration || '');
          const video = c.videoUrl ? '链接' : (c.videoFileId ? '本地' : '');
          return '<tr><td>' + escapeHtml(c.date) + '</td><td>' + escapeHtml(type) + '</td><td>' + escapeHtml(col3) + '</td><td>' + escapeHtml(col4) + '</td><td>' + escapeHtml(c.notes || '') + '</td><td>' + video + '</td></tr>';
        }).join('');
      }
      tableHint.textContent = '共 ' + climbs.length + ' 条记录，可导出 CSV。';
    }
  }

  tableSource.addEventListener('change', renderTable);

  document.getElementById('exportTableBtn').addEventListener('click', function () {
    const source = tableSource.value;
    let csv = '';
    let rows = [];
    if (source === 'courses') {
      const courses = getCourses();
      csv = '课程,项目/周,类型,名称,日期时限,完成,已上传GitHub\n';
      courses.forEach(function (c) {
        (c.items || []).forEach(function (i) {
          rows.push([c.name, i.unit || '', i.type, i.title, i.deadline || '', i.completed ? '是' : '否', i.githubUploaded ? '是' : '否'].map(escapeCsv).join(','));
        });
        if ((c.items || []).length === 0) rows.push([c.name, '', '', '', '', '', ''].map(escapeCsv).join(','));
      });
    } else if (source === 'plans') {
      const plans = getPlans().slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      csv = '日期,类型,内容\n';
      plans.forEach(function (p) {
        rows.push([p.date, p.type || '攀岩', p.content || ''].map(escapeCsv).join(','));
      });
    } else {
      const climbs = getClimbs().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
      csv = '日期,类型,难度或内容,结果或时长,备注,视频\n';
      climbs.forEach(function (c) {
        const type = c.recordType || '攀岩';
        const col3 = type === '攀岩' ? (c.grade || '') : (c.trainingContent || '');
        const col4 = type === '攀岩' ? (c.result || '') : (c.duration || '');
        const video = c.videoUrl ? c.videoUrl : (c.videoFileId ? '本地' : '');
        rows.push([c.date, type, col3, col4, c.notes || '', video].map(escapeCsv).join(','));
      });
    }
    csv += rows.join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var fname = (source === 'courses' ? '课程进度' : source === 'plans' ? '攀岩训练安排' : '攀岩训练记录') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  window.editCourse = editCourse;
  window.deleteCourse = deleteCourse;
  window.openCourseItemModal = openCourseItemModal;
  window.editCourseItem = editCourseItem;
  window.deleteCourseItem = deleteCourseItem;
  window.editClimb = editClimb;
  window.deleteClimb = deleteClimb;
  window.playClimbVideo = playClimbVideo;
  window.editPlan = editPlan;
  window.deletePlan = deletePlan;

  /* ---------- Init ---------- */
  closeCourseItemModal();
  toggleClimbFormByType();
  renderCourseCharts();
  renderCourseCards();
  renderClimbList();
  renderClimbCharts();
  renderPlanList();
  renderTable();
})();
