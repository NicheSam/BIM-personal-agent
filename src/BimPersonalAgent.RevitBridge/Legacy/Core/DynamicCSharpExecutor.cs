using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RevitMCP.Core
{
    public interface IDynamicRevitCommand
    {
        DynamicCommandMetadata Describe(DynamicRevitContext context);

        object Execute(DynamicRevitContext context);
    }

    public sealed class DynamicRevitContext
    {
        internal DynamicRevitContext(
            Document document,
            View activeView,
            IReadOnlyList<long> selectedElementIds,
            JObject inputs)
        {
            Document = document;
            ActiveView = activeView;
            SelectedElementIds = selectedElementIds;
            Inputs = inputs == null ? new JObject() : (JObject)inputs.DeepClone();
        }

        public Document Document { get; }

        public View ActiveView { get; }

        public IReadOnlyList<long> SelectedElementIds { get; }

        public JObject Inputs { get; }
    }

    public sealed class DynamicCommandMetadata
    {
        private DynamicCommandMetadata(string summary, bool isDestructive, IReadOnlyList<long> affectedElementIds)
        {
            Summary = summary;
            IsDestructive = isDestructive;
            AffectedElementIds = affectedElementIds ?? Array.Empty<long>();
        }

        public string Summary { get; }

        public bool IsDestructive { get; }

        public IReadOnlyList<long> AffectedElementIds { get; }

        public static DynamicCommandMetadata Reversible(string summary)
        {
            return new DynamicCommandMetadata(summary, false, Array.Empty<long>());
        }

        public static DynamicCommandMetadata Destructive(string summary, IEnumerable<long> affectedElementIds)
        {
            return new DynamicCommandMetadata(
                summary,
                true,
                (affectedElementIds ?? Enumerable.Empty<long>()).Distinct().ToArray());
        }
    }

    internal sealed class DynamicCompilationResult
    {
        public string SourceHash { get; set; }

        public bool UsesDestructiveApi { get; set; }

        public IDynamicRevitCommand Command { get; set; }

        public bool CacheHit { get; set; }
    }

    internal static class DynamicCSharpRuntime
    {
        private const int MaximumCompilationsPerSession = 50;
        private const int MaximumAffectedElements = 5000;
        private const int MaximumCachedCompilations = 24;

        private static int _compilationCount;
        private static readonly object CacheLock = new object();
        private static readonly Dictionary<string, DynamicCompilationResult> CompilationCache =
            new Dictionary<string, DynamicCompilationResult>(StringComparer.Ordinal);
        private static readonly Queue<string> CompilationCacheOrder = new Queue<string>();

        public static DynamicCompilationResult Compile(string source)
        {
            string sourceHash = DynamicCSharpPolicy.ComputeSourceHash(source);
            lock (CacheLock)
            {
                if (CompilationCache.TryGetValue(sourceHash, out DynamicCompilationResult cached))
                {
                    return new DynamicCompilationResult
                    {
                        SourceHash = cached.SourceHash,
                        UsesDestructiveApi = cached.UsesDestructiveApi,
                        Command = cached.Command,
                        CacheHit = true
                    };
                }
            }

            if (Volatile.Read(ref _compilationCount) >= MaximumCompilationsPerSession)
            {
                throw new InvalidOperationException("Dynamic C# reached the 50-compilation Revit-session limit. Restart Revit before compiling more code.");
            }

            DynamicSourceAnalysis analysis = DynamicCSharpPolicy.Analyze(source, GetCompilationReferences());

            using (var assemblyStream = new MemoryStream())
            {
                var emitResult = analysis.Compilation.Emit(assemblyStream);
                if (!emitResult.Success)
                {
                    IEnumerable<Diagnostic> emitErrors = emitResult.Diagnostics
                        .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)
                        .Take(20);
                    throw new InvalidOperationException(
                        "Dynamic C# emit failed:\n" +
                        string.Join("\n", emitErrors.Select(diagnostic => diagnostic.ToString())));
                }

                Assembly assembly = Assembly.Load(assemblyStream.ToArray());
                Type[] commandTypes = assembly.GetTypes()
                    .Where(type => typeof(IDynamicRevitCommand).IsAssignableFrom(type) &&
                                   type.IsClass && !type.IsAbstract && type.IsPublic)
                    .ToArray();
                if (commandTypes.Length != 1)
                {
                    throw new InvalidOperationException("Dynamic source must contain exactly one public IDynamicRevitCommand implementation.");
                }

                Interlocked.Increment(ref _compilationCount);
                var result = new DynamicCompilationResult
                {
                    SourceHash = analysis.SourceHash,
                    UsesDestructiveApi = analysis.UsesDestructiveApi,
                    Command = (IDynamicRevitCommand)Activator.CreateInstance(commandTypes[0]),
                    CacheHit = false
                };

                lock (CacheLock)
                {
                    CompilationCache[result.SourceHash] = result;
                    CompilationCacheOrder.Enqueue(result.SourceHash);
                    while (CompilationCacheOrder.Count > MaximumCachedCompilations)
                    {
                        CompilationCache.Remove(CompilationCacheOrder.Dequeue());
                    }
                }

                return result;
            }
        }

        private static List<MetadataReference> GetCompilationReferences()
        {
            Assembly[] requiredAssemblies =
            {
                typeof(object).Assembly,
                typeof(Uri).Assembly,
                typeof(Enumerable).Assembly,
                typeof(Document).Assembly,
                typeof(UIApplication).Assembly,
                typeof(IDynamicRevitCommand).Assembly,
                typeof(JObject).Assembly
            };

            return requiredAssemblies
                .Where(assembly => !assembly.IsDynamic && !string.IsNullOrWhiteSpace(assembly.Location))
                .Select(assembly => assembly.Location)
                .Where(File.Exists)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(path => (MetadataReference)MetadataReference.CreateFromFile(path))
                .ToList();
        }

        public static void ValidateDestructiveScope(Document document, DynamicCommandMetadata metadata)
        {
            if (metadata.AffectedElementIds == null || metadata.AffectedElementIds.Count == 0)
            {
                throw new InvalidOperationException("Destructive dynamic C# must declare affected element IDs in Describe().");
            }

            if (metadata.AffectedElementIds.Count > MaximumAffectedElements)
            {
                throw new InvalidOperationException("Destructive scope exceeds 5,000 declared elements.");
            }

            List<long> missingIds = metadata.AffectedElementIds
                .Where(id => document.GetElement(new ElementId(id)) == null)
                .Take(20)
                .ToList();
            if (missingIds.Count > 0)
            {
                throw new InvalidOperationException("Destructive scope contains missing element IDs: " + string.Join(", ", missingIds));
            }
        }

        public static string NormalizeSummary(string summary)
        {
            string normalized = string.IsNullOrWhiteSpace(summary) ? "Dynamic C# operation" : summary.Trim();
            return normalized.Length <= 500 ? normalized : normalized.Substring(0, 500);
        }

        public static object NormalizeResult(object result)
        {
            if (result == null || result is string || result is JToken || result.GetType().IsPrimitive || result is decimal)
            {
                return result;
            }

            var element = result as Element;
            if (element != null)
            {
                return new
                {
                    ElementId = element.Id.Value,
                    Name = element.Name,
                    Category = element.Category?.Name
                };
            }

            try
            {
                return JToken.FromObject(result);
            }
            catch
            {
                return result.ToString();
            }
        }

        public static void Audit(string source, string sourceHash, string mode, string status, string message)
        {
            try
            {
                string root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "BIMPersonalAgent",
                    "audits",
                    "DynamicCSharp",
                    DateTime.UtcNow.ToString("yyyyMMdd"));
                Directory.CreateDirectory(root);
                string sourcePath = Path.Combine(root, sourceHash + ".cs");
                if (!File.Exists(sourcePath))
                {
                    File.WriteAllText(sourcePath, source, new UTF8Encoding(false));
                }

                string auditPath = Path.Combine(root, "audit.jsonl");
                var record = new JObject
                {
                    ["timestampUtc"] = DateTime.UtcNow.ToString("O"),
                    ["sourceHash"] = sourceHash,
                    ["mode"] = mode,
                    ["status"] = status,
                    ["message"] = message
                };
                File.AppendAllText(auditPath, record.ToString(Formatting.None) + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                Logger.Error("Dynamic C# audit write failed", ex);
            }
        }

        public static int CompilationCount => Volatile.Read(ref _compilationCount);

    }

    public partial class CommandExecutor
    {
        private object GetTaskContext(JObject parameters)
        {
            UIDocument uiDocument = _uiApp.ActiveUIDocument;
            if (uiDocument == null)
            {
                throw new InvalidOperationException("No active Revit document.");
            }

            Document document = uiDocument.Document;
            int maxSelectedElements = Math.Max(
                1,
                Math.Min(50, parameters.Value<int?>("maxSelectedElements") ?? 20));
            bool includeSchema = parameters.Value<bool?>("includeSchema") ?? true;
            ElementId[] selectedIds = uiDocument.Selection.GetElementIds().ToArray();
            var selectedElements = selectedIds
                .Take(maxSelectedElements)
                .Select(id => document.GetElement(id))
                .Where(element => element != null)
                .Select(element => new
                {
                    ElementId = element.Id.Value,
                    element.Name,
                    Category = element.Category?.Name,
                    Type = document.GetElement(element.GetTypeId())?.Name,
                    Level = document.GetElement(element.LevelId)?.Name
                })
                .ToList();

            return new
            {
                ProjectFingerprint = ComputeProjectFingerprint(document),
                Project = GetProjectInfo(),
                ActiveView = GetActiveView(),
                Levels = GetAllLevels(),
                Selection = new
                {
                    TotalCount = selectedIds.Length,
                    ReturnedCount = selectedElements.Count,
                    Truncated = selectedIds.Length > selectedElements.Count,
                    Elements = selectedElements
                },
                ActiveSchema = includeSchema ? GetActiveSchema(new JObject()) : null
            };
        }

        private object ExecuteDynamicCSharp(JObject parameters)
        {
            string source = parameters.Value<string>("source");
            string mode = (parameters.Value<string>("mode") ?? "execute").Trim().ToLowerInvariant();
            if (mode != "analyze" && mode != "execute")
            {
                throw new InvalidOperationException("mode must be analyze or execute.");
            }

            DynamicCompilationResult compiled = null;
            try
            {
                compiled = DynamicCSharpRuntime.Compile(source);
                if (mode == "analyze")
                {
                    DynamicCSharpRuntime.Audit(source, compiled.SourceHash, mode, "analyzed", null);
                    return new
                    {
                        Mode = mode,
                        SourceHash = compiled.SourceHash,
                        Compiled = true,
                        CompilationCacheHit = compiled.CacheHit,
                        SessionCompilationCount = DynamicCSharpRuntime.CompilationCount,
                        DestructiveApiDetected = compiled.UsesDestructiveApi,
                        Executed = false
                    };
                }

                UIDocument uiDocument = _uiApp.ActiveUIDocument;
                if (uiDocument == null)
                {
                    throw new InvalidOperationException("No active Revit document.");
                }

                Document document = uiDocument.Document;
                var context = new DynamicRevitContext(
                    document,
                    document.ActiveView,
                    uiDocument.Selection.GetElementIds().Select(id => id.Value).ToArray(),
                    parameters["inputs"] as JObject ?? new JObject());
                DynamicCommandMetadata metadata = compiled.Command.Describe(context) ??
                    throw new InvalidOperationException("Describe() returned null metadata.");
                string summary = DynamicCSharpRuntime.NormalizeSummary(metadata.Summary);
                bool destructive = compiled.UsesDestructiveApi || metadata.IsDestructive;

                if (compiled.UsesDestructiveApi && !metadata.IsDestructive)
                {
                    throw new InvalidOperationException("Document.Delete was detected, but Describe() did not declare the operation destructive.");
                }

                if (destructive)
                {
                    DynamicCSharpRuntime.ValidateDestructiveScope(document, metadata);
                }

                object executionResult;
                long[] actualDeletedIds = Array.Empty<long>();
                long[] actualCreatedIds = Array.Empty<long>();
                HashSet<long> beforeElementIds = destructive
                    ? CollectAllElementIds(document)
                    : null;
                string transactionName = "BIM Personal Agent: " + summary;
                using (Transaction transaction = TransactionHelper.Begin(document, transactionName))
                {
                    transaction.Start();
                    try
                    {
                        executionResult = compiled.Command.Execute(context);

                        if (destructive)
                        {
                            HashSet<long> afterElementIds = CollectAllElementIds(document);
                            actualDeletedIds = beforeElementIds.Except(afterElementIds).OrderBy(id => id).ToArray();
                            actualCreatedIds = afterElementIds.Except(beforeElementIds).OrderBy(id => id).ToArray();
                            if (actualDeletedIds.Length > 5000)
                            {
                                transaction.RollBack();
                                throw new InvalidOperationException("Dynamic C# attempted to delete more than 5,000 actual elements.");
                            }

                            string declaredIds = FormatIdList(metadata.AffectedElementIds);
                            string deletedIds = FormatIdList(actualDeletedIds);
                            string createdIds = FormatIdList(actualCreatedIds);
                            string scope = summary +
                                "\n\nDeclared target IDs (" + metadata.AffectedElementIds.Count + "):\n" + declaredIds +
                                "\n\nActual deleted IDs including dependents (" + actualDeletedIds.Length + "):\n" + deletedIds +
                                "\n\nActual created IDs (" + actualCreatedIds.Length + "):\n" + createdIds +
                                "\n\nCommit these changes?";
                            TaskDialogResult answer = TaskDialog.Show(
                                "Dynamic C# destructive operation",
                                scope,
                                TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No);
                            if (answer != TaskDialogResult.Yes)
                            {
                                transaction.RollBack();
                                DynamicCSharpRuntime.Audit(source, compiled.SourceHash, mode, "cancelled", summary);
                                return new
                                {
                                    Mode = mode,
                                    SourceHash = compiled.SourceHash,
                                    Compiled = true,
                                    CompilationCacheHit = compiled.CacheHit,
                                    SessionCompilationCount = DynamicCSharpRuntime.CompilationCount,
                                    Destructive = true,
                                    Executed = false,
                                    Cancelled = true,
                                    ActualDeletedElementIds = actualDeletedIds,
                                    ActualCreatedElementIds = actualCreatedIds
                                };
                            }
                        }

                        transaction.Commit();
                    }
                    catch
                    {
                        if (transaction.GetStatus() == TransactionStatus.Started)
                        {
                            transaction.RollBack();
                        }
                        throw;
                    }
                }

                DynamicCSharpRuntime.Audit(source, compiled.SourceHash, mode, "executed", summary);
                return new
                {
                    Mode = mode,
                    SourceHash = compiled.SourceHash,
                    Compiled = true,
                    CompilationCacheHit = compiled.CacheHit,
                    SessionCompilationCount = DynamicCSharpRuntime.CompilationCount,
                    Destructive = destructive,
                    Executed = true,
                    Summary = summary,
                    TransactionName = transactionName,
                    ActualDeletedElementIds = actualDeletedIds,
                    ActualCreatedElementIds = actualCreatedIds,
                    Result = DynamicCSharpRuntime.NormalizeResult(executionResult)
                };
            }
            catch (Exception ex)
            {
                string hash = compiled?.SourceHash ?? "uncompiled";
                DynamicCSharpRuntime.Audit(source ?? string.Empty, hash, mode, "failed", ex.Message);
                throw;
            }
        }

        private static string FormatIdList(IEnumerable<long> ids)
        {
            long[] values = (ids ?? Enumerable.Empty<long>()).ToArray();
            if (values.Length == 0)
            {
                return "(none)";
            }

            string text = string.Join(", ", values.Take(50));
            return values.Length > 50 ? text + $" ... (+{values.Length - 50})" : text;
        }

        private static HashSet<long> CollectAllElementIds(Document document)
        {
            ElementFilter allElements = new LogicalOrFilter(
                new ElementIsElementTypeFilter(false),
                new ElementIsElementTypeFilter(true));
            return new HashSet<long>(
                new FilteredElementCollector(document)
                    .WherePasses(allElements)
                    .ToElementIds()
                    .Select(id => id.Value));
        }

        private static string ComputeProjectFingerprint(Document document)
        {
            string uniqueId = document.ProjectInformation?.UniqueId ?? string.Empty;
            string basis = uniqueId + "|" + document.Title;
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(basis));
                return string.Concat(hash.Select(value => value.ToString("x2")));
            }
        }
    }
}
